import { SetupLogger, LoggerInterface } from '@platform/entity/logger';
import { Subscriber, Subjects, Subject } from '@platform/env/subscription';
import { Range, IRange } from '@platform/types/range';
import { cutUuid } from '@log/index';
import { Rank } from './rank';
import { IGrabbedElement } from '@platform/types/content';
import { DataSource, ObservedSourceLink } from '@platform/types/observe';
import { ObserveOperation } from './observe/operation';
import { ObserveSource } from './observe/source';
import { error } from '@platform/log/utils';
import { SourceDefinition } from '@platform/types/transport';
import { IDLTOptions, parserSettingsToOptions } from '@platform/types/parsers/dlt';
import { TargetFile } from '@platform/types/files';

import * as Requests from '@platform/ipc/request';
import * as Events from '@platform/ipc/event';

export { ObserveOperation, DataSource };

type Handler = () => void;

interface OpenFile {
    open(): Promise<void>;
    onProcessing(handler: Handler): OpenFile;
}

const PROCESSING_PREFIX = 'processing_';

@SetupLogger()
export class Stream extends Subscriber {
    public readonly subjects: Subjects<{
        // Stream is updated (new rows came)
        updated: Subject<number>;
        // New observe operation is started
        started: Subject<DataSource>;
        // Observe operation for source is finished
        finished: Subject<DataSource>;
        // List of sources (observed operations has been changed)
        sources: Subject<void>;
        // Session rank is changed
        rank: Subject<number>;
    }> = new Subjects({
        updated: new Subject<number>(),
        started: new Subject<DataSource>(),
        finished: new Subject<DataSource>(),
        sources: new Subject<void>(),
        rank: new Subject<number>(),
    });
    private _len: number = 0;
    private _uuid!: string;
    private _handlers: Map<string, Handler> = new Map();

    public readonly observed: {
        running: Map<string, ObserveOperation>;
        done: Map<string, DataSource>;
        map: Map<number, ObservedSourceLink>;
    } = {
        running: new Map(),
        done: new Map(),
        map: new Map(),
    };
    public readonly rank: Rank = new Rank();

    public init(uuid: string) {
        this.setLoggerName(`Stream: ${cutUuid(uuid)}`);
        this._uuid = uuid;
        this.register(
            Events.IpcEvent.subscribe(Events.Stream.Updated.Event, (event) => {
                if (event.session !== this._uuid) {
                    return;
                }
                this._len = event.rows;
                this.subjects.get().updated.emit(this._len);
                if (this.rank.set(this._len.toString().length)) {
                    this.subjects.get().rank.emit(this.rank.len);
                }
            }),
        );
        this.register(
            Events.IpcEvent.subscribe(Events.Observe.Started.Event, (event) => {
                if (event.session !== this._uuid) {
                    return;
                }
                const source = DataSource.from(event.source);
                if (source instanceof Error) {
                    this.log().error(`Fail to parse DataSource: ${source.message}`);
                    return;
                }
                this.observed.running.set(
                    event.operation,
                    new ObserveOperation(
                        event.operation,
                        source,
                        this.observe().sde,
                        this.observe().restart,
                        this.observe().abort,
                    ),
                );
                this.observe()
                    .descriptions.request()
                    .then((sources) => {
                        sources.forEach((source) => {
                            if (!this.observed.map.has(source.id)) {
                                this.observed.map.set(source.id, source);
                                this.subjects.get().sources.emit();
                            }
                        });
                    })
                    .catch((err: Error) => {
                        this.log().error(`Fail get sources description: ${err.message}`);
                    });
                this.subjects.get().started.emit(source);
            }),
        );
        this.register(
            Events.IpcEvent.subscribe(Events.Observe.Processing.Event, (event) => {
                if (event.session !== this._uuid) {
                    return;
                }
                const key = `${PROCESSING_PREFIX}${event.operation}`;
                const handler = this._handlers.get(key);
                this._handlers.delete(key);
                handler !== undefined && handler();
            }),
        );
        this.register(
            Events.IpcEvent.subscribe(Events.Observe.Finished.Event, (event) => {
                if (event.session !== this._uuid) {
                    return;
                }
                const stored = this.observed.running.get(event.operation);
                if (stored === undefined) {
                    return;
                }
                this.observed.done.set(event.operation, stored.asSource());
                this.observed.running.delete(event.operation);
                this.subjects.get().finished.emit(stored.asSource());
            }),
        );
    }

    public destroy() {
        this.unsubscribe();
        this.subjects.destroy();
    }

    public file(file: TargetFile): OpenFile {
        let onProcessingHandler: undefined | Handler;
        const output = {
            open: (): Promise<void> => {
                return new Promise((resolve, reject) => {
                    Requests.IpcRequest.send<Requests.File.Open.Response>(
                        Requests.File.Open.Response,
                        new Requests.File.Open.Request({ session: this._uuid, file }),
                    )
                        .then((response) => {
                            if (typeof response.error === 'string' && response.error !== '') {
                                reject(new Error(response.error));
                            } else {
                                if (onProcessingHandler !== undefined) {
                                    this._handlers.set(
                                        `${PROCESSING_PREFIX}${response.observer}`,
                                        onProcessingHandler,
                                    );
                                }
                                resolve(undefined);
                            }
                        })
                        .catch(reject);
                });
            },
            onProcessing: (handler: Handler): OpenFile => {
                onProcessingHandler = handler;
                return output;
            },
        };
        return output;
    }

    public open(file: TargetFile): Promise<void> {
        return new Promise((resolve, reject) => {
            Requests.IpcRequest.send<Requests.File.Open.Response>(
                Requests.File.Open.Response,
                new Requests.File.Open.Request({ session: this._uuid, file }),
            )
                .then((response) => {
                    if (typeof response.error === 'string' && response.error !== '') {
                        reject(new Error(response.error));
                    } else {
                        resolve(undefined);
                    }
                })
                .catch(reject);
        });
    }

    public concat(files: TargetFile[]): Promise<void> {
        return new Promise((resolve, reject) => {
            Requests.IpcRequest.send<Requests.File.Concat.Response>(
                Requests.File.Concat.Response,
                new Requests.File.Concat.Request({ session: this._uuid, files }),
            )
                .then((response) => {
                    if (typeof response.error === 'string' && response.error !== '') {
                        reject(new Error(response.error));
                    } else {
                        resolve(undefined);
                    }
                })
                .catch(reject);
        });
    }

    public connect(source: SourceDefinition): {
        dlt(options: IDLTOptions): Promise<void>;
        text(): Promise<void>;
        source(source: DataSource): Promise<void>;
    } {
        return {
            dlt: (options: IDLTOptions): Promise<void> => {
                return new Promise((resolve, reject) => {
                    Requests.IpcRequest.send<Requests.Connect.Dlt.Response>(
                        Requests.Connect.Dlt.Response,
                        new Requests.Connect.Dlt.Request({ session: this._uuid, source, options }),
                    )
                        .then((response) => {
                            if (typeof response.error === 'string' && response.error !== '') {
                                reject(new Error(response.error));
                            } else {
                                resolve(undefined);
                            }
                        })
                        .catch(reject);
                });
            },
            text: (): Promise<void> => {
                return new Promise((resolve, reject) => {
                    Requests.IpcRequest.send<Requests.Connect.Text.Response>(
                        Requests.Connect.Text.Response,
                        new Requests.Connect.Text.Request({ session: this._uuid, source }),
                    )
                        .then((response) => {
                            if (typeof response.error === 'string' && response.error !== '') {
                                reject(new Error(response.error));
                            } else {
                                resolve(undefined);
                            }
                        })
                        .catch(reject);
                });
            },
            source: (src: DataSource): Promise<void> => {
                const stream = src.asStream();
                if (stream === undefined) {
                    return Promise.reject(new Error(`Operation is available only for streams`));
                }
                if (src.parser.Dlt !== undefined) {
                    return this.connect(source).dlt(parserSettingsToOptions(src.parser.Dlt));
                } else if (src.parser.Text !== undefined) {
                    return this.connect(source).text();
                }
                return Promise.reject(new Error(`Unsupported type of source`));
            },
        };
    }

    public len(): number {
        return this._len;
    }

    public observe(): {
        abort(uuid: string): Promise<void>;
        restart(uuid: string, source: DataSource): Promise<void>;
        list(): Promise<Map<string, DataSource>>;
        sources(): ObserveSource[];
        descriptions: {
            get(id: number): ObservedSourceLink | undefined;
            id(alias: string): number | undefined;
            request(): Promise<ObservedSourceLink[]>;
            count(): number;
        };
        sde<T, R>(uuid: string, msg: T): Promise<R>;
    } {
        return {
            abort: (uuid: string): Promise<void> => {
                return new Promise((resolve, reject) => {
                    Requests.IpcRequest.send(
                        Requests.Observe.Abort.Response,
                        new Requests.Observe.Abort.Request({
                            session: this._uuid,
                            operation: uuid,
                        }),
                    )
                        .then((response: Requests.Observe.Abort.Response) => {
                            if (response.error !== undefined) {
                                return reject(new Error(response.error));
                            }
                            resolve(undefined);
                        })
                        .catch((error: Error) => {
                            this.log().error(
                                `Fail to cancel observe operation sources: ${error.message}`,
                            );
                        });
                });
            },
            restart: (uuid: string, source: DataSource): Promise<void> => {
                return this.observe()
                    .abort(uuid)
                    .then(() => {
                        const sourceDef = source.asSourceDefinition();
                        if (sourceDef instanceof Error) {
                            this.log().error(sourceDef.message);
                            return;
                        }
                        return this.connect(sourceDef).source(source);
                    })
                    .catch((error: Error) => {
                        this.log().error(
                            `Fail to restart observe operation sources: ${error.message}`,
                        );
                    });
            },
            list: (): Promise<Map<string, DataSource>> => {
                return new Promise((resolve) => {
                    Requests.IpcRequest.send(
                        Requests.Observe.List.Response,
                        new Requests.Observe.List.Request({
                            session: this._uuid,
                        }),
                    )
                        .then((response: Requests.Observe.List.Response) => {
                            const sources: Map<string, DataSource> = new Map();
                            Object.keys(response.sources).forEach((uuid: string) => {
                                const source = DataSource.from(response.sources[uuid]);
                                if (source instanceof Error) {
                                    this.log().error(`Fail to parse DataSource: ${source.message}`);
                                    return;
                                }
                                sources.set(uuid, source);
                            });
                            resolve(sources);
                        })
                        .catch((error: Error) => {
                            this.log().error(
                                `Fail to get a list of observed sources: ${error.message}`,
                            );
                        });
                });
            },
            sources: (): ObserveSource[] => {
                const sources: ObserveSource[] = [];
                Array.from(this.observed.running.values()).forEach((observed: ObserveOperation) => {
                    const source = observed.asSource();
                    if (source.childs.length !== 0) {
                        sources.push(...source.childs.map((s) => new ObserveSource(s, observed)));
                    } else {
                        sources.push(new ObserveSource(source, observed));
                    }
                });
                Array.from(this.observed.done.values()).forEach((source: DataSource) => {
                    if (source.childs.length !== 0) {
                        sources.push(...source.childs.map((s) => new ObserveSource(s)));
                    } else {
                        sources.push(new ObserveSource(source));
                    }
                });
                return sources;
            },
            descriptions: {
                get: (id: number): ObservedSourceLink | undefined => {
                    return this.observed.map.get(id);
                },
                id: (alias: string): number | undefined => {
                    const link = Array.from(this.observed.map.values()).find(
                        (s) => s.alias === alias,
                    );
                    return link !== undefined ? link.id : undefined;
                },
                request: (): Promise<ObservedSourceLink[]> => {
                    return new Promise((resolve, reject) => {
                        Requests.IpcRequest.send(
                            Requests.Observe.SourcesDefinitionsList.Response,
                            new Requests.Observe.SourcesDefinitionsList.Request({
                                session: this._uuid,
                            }),
                        )
                            .then((response: Requests.Observe.SourcesDefinitionsList.Response) => {
                                resolve(response.sources);
                            })
                            .catch(reject);
                    });
                },
                count: (): number => {
                    return this.observed.map.size;
                },
            },
            sde: <T, R>(uuid: string, msg: T): Promise<R> => {
                return new Promise((resolve, reject) => {
                    Requests.IpcRequest.send(
                        Requests.Observe.SDE.Response,
                        new Requests.Observe.SDE.Request({
                            session: this._uuid,
                            operation: uuid,
                            json: JSON.stringify(msg),
                        }),
                    )
                        .then((response: Requests.Observe.SDE.Response) => {
                            if (response.error !== undefined) {
                                return reject(new Error(response.error));
                            }
                            if (response.result === undefined) {
                                return reject(new Error(`SDE doesn't return any kind of result`));
                            }
                            try {
                                resolve(JSON.parse(response.result) as unknown as R);
                            } catch (e) {
                                return reject(new Error(error(e)));
                            }
                        })
                        .catch((error: Error) => {
                            this.log().error(`Fail to send SDE into operation: ${error.message}`);
                        });
                });
            },
        };
    }

    public chunk(range: Range): Promise<IGrabbedElement[]> {
        if (this._len === 0) {
            // TODO: Grabber is crash session in this case... should be prevented on grabber level
            return Promise.resolve([]);
        }
        return new Promise((resolve) => {
            Requests.IpcRequest.send(
                Requests.Stream.Chunk.Response,
                new Requests.Stream.Chunk.Request({
                    session: this._uuid,
                    from: range.from,
                    to: range.to,
                }),
            )
                .then((response: Requests.Stream.Chunk.Response) => {
                    resolve(response.rows);
                })
                .catch((error: Error) => {
                    this.log().error(`Fail to grab content: ${error.message}`);
                });
        });
    }

    public grab(ranges: IRange[]): Promise<IGrabbedElement[]> {
        if (this._len === 0) {
            // TODO: Grabber is crash session in this case... should be prevented on grabber level
            return Promise.resolve([]);
        }
        return new Promise((resolve) => {
            Requests.IpcRequest.send(
                Requests.Stream.Ranges.Response,
                new Requests.Stream.Ranges.Request({
                    session: this._uuid,
                    ranges,
                }),
            )
                .then((response: Requests.Stream.Ranges.Response) => {
                    resolve(response.rows);
                })
                .catch((error: Error) => {
                    this.log().error(`Fail to grab content: ${error.message}`);
                });
        });
    }

    public export(): {
        text(dest: string, ranges: IRange[]): Promise<boolean>;
        raw(dest: string, ranges: IRange[]): Promise<boolean>;
        isRawAvailable(): Promise<boolean>;
    } {
        return {
            text: (dest: string, ranges: IRange[]): Promise<boolean> => {
                if (this._len === 0) {
                    return Promise.resolve(true);
                }
                return new Promise((resolve, reject) => {
                    Requests.IpcRequest.send(
                        Requests.Session.Export.Response,
                        new Requests.Session.Export.Request({
                            session: this._uuid,
                            dest,
                            ranges,
                        }),
                    )
                        .then((response: Requests.Session.Export.Response) => {
                            if (response.error !== undefined) {
                                return reject(new Error(response.error));
                            }
                            resolve(response.complete);
                        })
                        .catch((error: Error) => {
                            this.log().error(`Fail to export content: ${error.message}`);
                        });
                });
            },
            raw: (dest: string, ranges: IRange[]): Promise<boolean> => {
                if (this._len === 0) {
                    return Promise.resolve(true);
                }
                return new Promise((resolve, reject) => {
                    Requests.IpcRequest.send(
                        Requests.Session.ExportRaw.Response,
                        new Requests.Session.ExportRaw.Request({
                            session: this._uuid,
                            dest,
                            ranges,
                        }),
                    )
                        .then((response: Requests.Session.ExportRaw.Response) => {
                            if (response.error !== undefined) {
                                return reject(new Error(response.error));
                            }
                            resolve(response.complete);
                        })
                        .catch((error: Error) => {
                            this.log().error(`Fail to export raw: ${error.message}`);
                        });
                });
            },
            isRawAvailable: (): Promise<boolean> => {
                if (this._len === 0) {
                    return Promise.resolve(false);
                }
                return new Promise((resolve, reject) => {
                    Requests.IpcRequest.send(
                        Requests.Session.IsExportRawAvailable.Response,
                        new Requests.Session.IsExportRawAvailable.Request({
                            session: this._uuid,
                        }),
                    )
                        .then((response: Requests.Session.IsExportRawAvailable.Response) => {
                            if (response.error !== undefined) {
                                return reject(new Error(response.error));
                            }
                            resolve(response.available);
                        })
                        .catch((error: Error) => {
                            this.log().error(`Fail to check state export raw: ${error.message}`);
                        });
                });
            },
        };
    }
}
export interface Stream extends LoggerInterface {}
