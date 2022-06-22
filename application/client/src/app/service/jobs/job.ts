import { unique } from '@platform/env/sequence';
import * as validator from '@platform/env/obj';

export interface IJob {
    uuid: string;
    progress: number;
    session?: string;
    desc?: string;
}

export class Job {
    static GLOBAL_JOBS = `___global_jobs___`;

    public uuid: string;
    public progress = 0;
    public session: string;
    public pinned: boolean;
    public desc?: string;
    public icon?: string;

    constructor(job: {
        uuid?: string;
        session?: string;
        desc?: string;
        progress?: number;
        pinned?: boolean;
        icon?: string;
    }) {
        this.uuid = job.uuid !== undefined ? job.uuid : unique();
        this.session = validator.getAsNotEmptyStringOrAsUndefined(job, 'session');
        this.desc = validator.getAsNotEmptyStringOrAsUndefined(job, 'desc');
        this.icon = validator.getAsNotEmptyStringOrAsUndefined(job, 'icon');
        this.progress = validator.getAsValidNumber(job, 'progress', {
            defaults: 0,
            max: 100,
            min: 0,
        });
        this.pinned = validator.getAsBool(job, 'pinned', false);
        this.session = this.session === undefined ? Job.GLOBAL_JOBS : this.session;
    }

    public update(job: { desc?: string; progress?: number; pinned?: boolean; icon?: string }) {
        this.desc = job.desc !== undefined ? job.desc : this.desc;
        this.pinned = job.pinned !== undefined ? job.pinned : this.pinned;
        this.progress = job.progress !== undefined ? job.progress : this.progress;
        this.icon = job.icon !== undefined ? job.icon : this.icon;
    }

    public isDone(): boolean {
        return this.progress === 100;
    }
}