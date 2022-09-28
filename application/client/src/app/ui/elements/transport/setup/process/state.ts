import { ProcessTransportSettings } from '@platform/types/transport/process';
import { Base } from '../common/state';

export class State extends Base<ProcessTransportSettings> {
    public cwd: string = '';
    public command: string = '';
    public env: { [key: string]: string } = {};

    public from(opt: ProcessTransportSettings) {
        this.cwd = opt.cwd;
        this.command = `${opt.command}${opt.args.length > 0 ? ' ' : ''}${opt.args.join(' ')}`;
        this.env = opt.envs;
    }

    public asSourceDefinition(): ProcessTransportSettings {
        const parts = this.command.split(' ');
        return {
            command: parts[0],
            cwd: this.cwd,
            args: parts.slice(1),
            envs: this.env,
        };
    }
}