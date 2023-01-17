use crate::{command::sde, ByteSource, Error as SourceError, ReloadInfo, SourceFilter};
use async_trait::async_trait;
use buf_redux::Buffer;
use futures;
use regex::{Captures, Regex};
use std::{collections::HashMap, ffi::OsString, path::PathBuf, process::Stdio};
use thiserror::Error;
use tokio::{
    io::AsyncWriteExt,
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command},
    select,
};
use tokio_stream::StreamExt;
use tokio_util::codec::{self, FramedRead, LinesCodec};

#[derive(Error, Debug)]
pub enum ProcessError {
    #[error("Process setup problem: {0}")]
    Setup(String),
    #[error("Unrecoverable process error: {0}")]
    Unrecoverable(String),
}

pub struct ProcessSource {
    process: Child,
    buffer: Buffer,
    stdout: FramedRead<ChildStdout, LinesCodec>,
    stderr: FramedRead<ChildStderr, LinesCodec>,
    stdin: ChildStdin,
}

impl Drop for ProcessSource {
    fn drop(&mut self) {
        if let Err(err) = futures::executor::block_on(self.process.kill()) {
            error!("Fail to kill child process: {}", err);
        }
    }
}

impl ProcessSource {
    pub fn parse_args(args: Vec<String>) -> Result<Vec<OsString>, ProcessError> {
        let group_re = Regex::new(r#"".*?""#)
            .map_err(|_| ProcessError::Setup(String::from("Fail to build regex")))?;
        let quote_re = Regex::new(r#"""#)
            .map_err(|_| ProcessError::Setup(String::from("Fail to build regex")))?;
        let args_str = args.join(" ");
        let mut groups: Vec<String> = vec![];
        let parsed = group_re.replace_all(&args_str, |caps: &Captures| {
            let index = groups.len();
            if caps.len() != 0 {
                let group = caps[0].to_string();
                groups.push(quote_re.replace_all(&group, "").to_string());
            }
            format!("==extraction:({index})==")
        });
        Ok(parsed
            .split(' ')
            .map(|a| {
                let mut str = a.to_string();
                for (i, g) in groups.iter().enumerate() {
                    let key = format!("==extraction:({i})==");
                    str = str.replace(&key, g).to_owned();
                }
                OsString::from(str)
            })
            .collect())
    }

    pub async fn new(
        command: String,
        cwd: PathBuf,
        args: Vec<String>,
        envs: HashMap<String, String>,
    ) -> Result<Self, ProcessError> {
        let mut process = Command::new(command)
            .args(ProcessSource::parse_args(args)?)
            .current_dir(OsString::from(cwd))
            .envs(envs)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| ProcessError::Setup(format!("{e}")))?;
        let stdout = codec::FramedRead::new(
            process
                .stdout
                .take()
                .ok_or_else(|| ProcessError::Setup(String::from("Fail to get stdout handle")))?,
            LinesCodec::default(),
        );
        let stderr = codec::FramedRead::new(
            process
                .stderr
                .take()
                .ok_or_else(|| ProcessError::Setup(String::from("Fail to get stderr handle")))?,
            LinesCodec::default(),
        );
        let stdin = process
            .stdin
            .take()
            .ok_or_else(|| ProcessError::Setup(String::from("Fail to get stdin handle")))?;
        Ok(Self {
            process,
            buffer: Buffer::new(),
            stdout,
            stderr,
            stdin,
        })
    }
}

#[async_trait]
impl ByteSource for ProcessSource {
    async fn reload(
        &mut self,
        _filter: Option<&SourceFilter>,
    ) -> Result<Option<ReloadInfo>, SourceError> {
        let mut closing = false;
        let mut output;
        loop {
            if !closing {
                output = select! {
                    res = self.stdout.next() => res,
                    res = self.stderr.next() => {
                        if res.is_none() {
                            closing = true;
                        }
                        res
                    },
                };
                if !closing {
                    break;
                }
            } else {
                output = self.stdout.next().await;
                break;
            }
        }
        if let Some(Ok(line)) = output {
            let stored = line.len() + 1;
            self.buffer.copy_from_slice(line.as_bytes());
            self.buffer.copy_from_slice(b"\n");
            Ok(Some(ReloadInfo::new(stored, stored, 0, None)))
        } else if let Some(Err(err)) = output {
            Err(SourceError::Unrecoverable(format!("{err}")))
        } else {
            Ok(None)
        }
    }

    fn current_slice(&self) -> &[u8] {
        self.buffer.buf()
    }

    fn consume(&mut self, offset: usize) {
        self.buffer.consume(offset);
    }

    fn len(&self) -> usize {
        self.buffer.len()
    }

    fn is_empty(&self) -> bool {
        self.len() == 0
    }

    async fn income(&mut self, msg: String) -> Result<String, String> {
        let request = serde_json::from_str::<sde::SdeRequest>(&msg)
            .map_err(|e| format!("Fail to deserialize message: {e}"))?;
        let response = match request {
            sde::SdeRequest::WriteText(str) => {
                let bytes = str.as_bytes();
                self.stdin
                    .write_all(bytes)
                    .await
                    .map_err(|e| format!("Fail to write string into stdin: {e}"))?;
                sde::SdeResponse::WriteText(sde::WriteResponse { bytes: bytes.len() })
            }
            sde::SdeRequest::WriteBytes(bytes) => {
                self.stdin
                    .write_all(&bytes)
                    .await
                    .map_err(|e| format!("Fail to write bytes into stdin: {e}"))?;
                sde::SdeResponse::WriteBytes(sde::WriteResponse { bytes: bytes.len() })
            }
        };
        serde_json::to_string(&response)
            .map_err(|e| format!("Fail to convert response to JSON: {e}"))
    }
}

#[tokio::test]
async fn test_process() -> Result<(), ProcessError> {
    use std::env;
    let mut command = "";
    if cfg!(windows) {
        command = "help";
    } else if cfg!(unix) {
        command = "ls";
    }
    let envs = HashMap::new();
    let args = Vec::new();
    match ProcessSource::new(command.to_string(), env::current_dir().unwrap(), args, envs).await {
        Ok(mut process_source) => {
            while process_source
                .reload(None)
                .await
                .expect("Reload data from process source failed")
                .is_some()
            {
                assert!(!process_source.current_slice().is_empty());
                // println!(
                //     "{}",
                //     std::str::from_utf8(process_source.current_slice()).unwrap()
                // );
                process_source.consume(process_source.current_slice().len());
            }
            Ok(())
        }
        Err(err) => Err(err),
    }
}

#[tokio::test]
async fn test_parsing() -> Result<(), ProcessError> {
    let parsed = ProcessSource::parse_args(vec![
        String::from("arg1"),
        String::from("arg2"),
        String::from(r#""some_path/with"#),
        String::from("space"),
        String::from("or"),
        String::from(r#"spaces""#),
        String::from("arg3"),
    ])?;
    assert_eq!(parsed.len(), 4);
    assert_eq!(parsed[0], OsString::from("arg1"));
    assert_eq!(parsed[1], OsString::from("arg2"));
    assert_eq!(parsed[2], OsString::from("some_path/with space or spaces"));
    assert_eq!(parsed[3], OsString::from("arg3"));
    let parsed = ProcessSource::parse_args(
        r#"arg1 arg2 "some_path/with space or spaces" arg3"#
            .split(" ")
            .into_iter()
            .map(|s| s.to_string())
            .collect::<Vec<String>>(),
    )?;
    assert_eq!(parsed.len(), 4);
    assert_eq!(parsed[0], OsString::from("arg1"));
    assert_eq!(parsed[1], OsString::from("arg2"));
    assert_eq!(parsed[2], OsString::from("some_path/with space or spaces"));
    assert_eq!(parsed[3], OsString::from("arg3"));
    Ok(())
}
