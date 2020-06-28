import { Subject, Observable } from 'rxjs';
import { IPCMessages } from '../services/service.electron.ipc';
import { CancelablePromise } from 'chipmunk.client.toolkit';

import ElectronIpcService from '../services/service.electron.ipc';
import OutputParsersService from '../services/standalone/service.output.parsers';

import * as Toolkit from 'chipmunk.client.toolkit';

export interface IRow {
    position: number;
    str: string;
    timestamp?: number;
    match?: string;
}

export interface IRange {
    id: number;
    start: IRow;
    end: IRow | undefined;
    duration: number;
    color: string;
    group: number;
}

export interface IState {
    min: number;
    max: number;
    duration: number;
}

export interface IFormat {
    format: string;
    regexp: RegExp;
}

class TimestampRowParser extends Toolkit.RowCommonParser {

    private _parser: (str: string) => string;

    constructor(parser: (str: string) => string) {
        super();
        this._parser = parser;
    }
    public parse(str: string, themeTypeRef: Toolkit.EThemeType, row: Toolkit.IRowInfo): string {
        return this._parser(str);
    }

}

const ROW_PARSER_ID = 'timestamps-row-parser';
const ROW_TOOLTIP_ID = 'timestamps-row-tooltip';

export interface DefaultDateParts {
    day: number | undefined;
    month: number | undefined;
    year: number | undefined;
}

export enum EChartMode {
    aligned = 'aligned',
    scaled = 'scaled'
}

export class ControllerSessionTabTimestamp {

    private _guid: string;
    private _logger: Toolkit.Logger;
    private _tasks: Map<string, CancelablePromise<any, any, any, any>> = new Map();
    private _format: IFormat[] = [];
    private _ranges: IRange[] = [];
    private _open: IRow | undefined;
    private _state: IState = { min: Infinity, max: -1, duration: 0 };
    private _sequences: {
        range: number,
        group: number,
    } = {
        range: 0,
        group: 0,
    };
    private _parser: TimestampRowParser;
    private _mode: EChartMode = EChartMode.aligned;
    private _defaults: DefaultDateParts = {
        day: undefined,
        month: undefined,
        year: undefined,
    };
    private _subjects: {
        change: Subject<IRange>,
        update: Subject<IRange[]>,
        formats: Subject<void>,
        defaults: Subject<DefaultDateParts>,
        mode: Subject<EChartMode>
    } = {
        change: new Subject(),
        update: new Subject(),
        formats: new Subject(),
        defaults: new Subject(),
        mode: new Subject(),
    };

    constructor(guid: string) {
        this._guid = guid;
        this._logger = new Toolkit.Logger(`ControllerSessionTabTimestamp: ${guid}`);
        this._parser = new TimestampRowParser(this._injectHighlightFormat.bind(this));
        OutputParsersService.setSessionParser(ROW_PARSER_ID, this._parser, this._guid);
        OutputParsersService.setSessionTooltip({ id: ROW_TOOLTIP_ID, getContent: this._getTooltipContent.bind(this)}, this._guid);
    }

    public destroy(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this._tasks.size === 0) {
                this._logger.debug(`No active tasks; no need to abort any.`);
                return resolve();
            }
            Promise.all(Array.from(this._tasks.values()).map((task: CancelablePromise<any, any, any, any>) => {
                return new Promise((resolveTask) => {
                    task.canceled(resolveTask);
                    task.abort('Controller is going to be destroyed');
                });
            })).then(() => {
                resolve();
                this._logger.debug(`All tasks are aborted; controller is destroyed.`);
            }).catch((err: Error) => {
                this._logger.error(`Unexpected error during destroying: ${err.message}`);
                reject(err);
            });
        });
    }

    public getObservable(): {
        change: Observable<IRange>,
        update: Observable<IRange[]>,
        formats: Observable<void>,
        defaults: Observable<DefaultDateParts>,
        mode: Observable<EChartMode>,
    } {
        return {
            change: this._subjects.change.asObservable(),
            update: this._subjects.update.asObservable(),
            formats: this._subjects.formats.asObservable(),
            defaults: this._subjects.defaults.asObservable(),
            mode: this._subjects.mode.asObservable(),
        };
    }

    public getState(): IState {
        return this._state;
    }

    public getFormats(): IFormat[] {
        return this._format.map((format: IFormat) => {
            return { format: format.format, regexp: format.regexp };
        });
    }

    public open(row: IRow, join?: boolean) {
        if (this._open !== undefined) {
            // Range already opened
            return;
        }
        this.getTimestamp(row.str).then((tm: number | undefined) => {
            if (tm === undefined) {
                return;
            }
            // Store timestamp
            row.timestamp = tm;
            // Detect matches
            row.match = this.getMatch(row.str);
            // Store opened point
            this._open = row;
            // Update group
            if (!join) {
                this._sequences.group += 1;
            }
            // Redraw rows (to show matches)
            OutputParsersService.updateRowsView();
        }).catch((err: Error) => {
            this._logger.error(`open:: Fail get timestamp due error: ${err.message}`);
        });
    }

    public close(row: IRow): Promise<void> {
        return new Promise((resolve) => {
            if (this._open === undefined) {
                return resolve();
            }
            this.getTimestamp(row.str).then((tm: number) => {
                row.timestamp = tm;
                if (row.timestamp === undefined) {
                    return resolve();
                }
                row.match = this.getMatch(row.str);
                if (this._open.timestamp > row.timestamp) {
                    const backup = this._open;
                    this._open = row;
                    row = backup;
                }
                this._ranges.push({
                    id: ++this._sequences.range,
                        start: this._open,
                        end: row,
                        duration: Math.abs(row.timestamp - this._open.timestamp),
                        color: this._getColor(),
                        group: this.getCurrentGroup(),
                });
                this._open = undefined;
                this._setState();
                this._subjects.update.next(this.getRanges());
                OutputParsersService.updateRowsView();
                return resolve();
            }).catch((err: Error) => {
                this._logger.error(`addRange:: Fail get timestamp due error: ${err.message}`);
                return resolve();
            });
        });
    }

    public removeRange(id: number) {
        this._ranges = this._ranges.filter((range: IRange) => {
            return range.id !== id;
        });
        this._subjects.update.next(this.getRanges());
    }

    public drop() {
        if (this._open === undefined) {
            return;
        }
        this._open = undefined;
        this._setState();
        this._subjects.update.next(this.getRanges());
        OutputParsersService.updateRowsView();
    }

    public clear(exceptions: number[] = []) {
        this._ranges = this._ranges.filter((row: IRange) => {
            return exceptions.indexOf(row.id) !== -1;
        });
        this._open = undefined;
        this._setState();
        this._subjects.update.next(this.getRanges());
        OutputParsersService.updateRowsView();
    }

    public getTimestamp(str: string): Promise<number | undefined> {
        return new Promise((resolve, reject) => {
            if (this._format.length === 0) {
                return resolve(undefined);
            }
            let inputStr: string | undefined;
            let formatStr: string | undefined;
            this._format.forEach((format: IFormat) => {
                if (inputStr !== undefined) {
                    return;
                }
                const match: RegExpMatchArray | null = str.match(format.regexp);
                if (match === null || match.length === 0) {
                    return undefined;
                }
                inputStr = match[0];
                formatStr = format.format;
            });
            if (inputStr === undefined) {
                return resolve(undefined);
            }
            this.extract(inputStr, formatStr).then((timestamp: number) => {
                resolve(timestamp);
            }).catch(reject);
        });
    }

    public getMatch(str: string): string | undefined {
        let match: string | undefined;
        this._format.forEach((format: IFormat) => {
            if (match !== undefined) {
                return;
            }
            const matches: RegExpMatchArray | null = str.match(format.regexp);
            if (matches === null || matches.length === 0) {
                return undefined;
            }
            match = matches[0];
        });
        return match;
    }

    public discover(update: boolean = false): CancelablePromise<void> {
        const id: string = Toolkit.guid();
        const task: CancelablePromise<void> = new CancelablePromise<void>(
            (resolve, reject, cancel, refCancelCB, self) => {
            if (this._format.length > 0 && !update) {
                return resolve();
            }
            this._format = [];
            ElectronIpcService.request(new IPCMessages.TimestampDiscoverRequest({
                session: this._guid,
                id: id,
            }), IPCMessages.TimestampDiscoverResponse).then((response: IPCMessages.TimestampDiscoverResponse) => {
                if (typeof response.error === 'string') {
                    this._logger.error(`Fail to discover files due error: ${response.error}`);
                    return reject(new Error(response.error));
                }
                if (response.format === undefined) {
                    return reject(new Error(`Format isn't detected.`));
                }
                const regexp: RegExp | Error = Toolkit.regTools.createFromStr(response.format.regex, response.format.flags.join(''));
                if (regexp instanceof Error) {
                    this._logger.warn(`Fail convert "${response.format.regex}" to RegExp due error: ${regexp.message}`);
                    return reject(regexp);
                }
                this._format.push({
                    format: response.format.format,
                    regexp: regexp,
                });
                this._subjects.formats.next();
                OutputParsersService.updateRowsView();
                resolve();
            }).catch((disErr: Error) => {
                this._logger.error(`Fail to discover files due error: ${disErr.message}`);
                return reject(disErr);
            });
        }).finally(() => {
            this._tasks.delete(id);
        });
        this._tasks.set(id, task);
        return task;
    }

    public validate(format: string): CancelablePromise<RegExp> {
        const id: string = Toolkit.guid();
        const task: CancelablePromise<RegExp> = new CancelablePromise<RegExp>(
            (resolve, reject, cancel, refCancelCB, self) => {
            ElectronIpcService.request(new IPCMessages.TimestampTestRequest({
                session: this._guid,
                format: format,
                id: id,
                flags: { miss_year: true, miss_month: true, miss_day: true }
            }), IPCMessages.TimestampTestResponse).then((response: IPCMessages.TimestampTestResponse) => {
                if (typeof response.error === 'string') {
                    this._logger.error(`Fail to test files due error: ${response.error}`);
                    return reject(new Error(response.error));
                }
                const regexp: RegExp | Error = Toolkit.regTools.createFromStr(response.format.regex, response.format.flags.join(''));
                if (regexp instanceof Error) {
                    this._logger.warn(`Fail convert "${response.format.regex}" to RegExp due error: ${regexp.message}`);
                    return reject(regexp);
                }
                resolve(regexp);
            }).catch((disErr: Error) => {
                this._logger.error(`Fail to test files due error: ${disErr.message}`);
                return reject(disErr);
            });
        }).finally(() => {
            this._tasks.delete(id);
        });
        this._tasks.set(id, task);
        return task;
    }

    public extract(str: string, format: string): CancelablePromise<number> {
        const id: string = Toolkit.guid();
        const task: CancelablePromise<number> = new CancelablePromise<number>(
            (resolve, reject, cancel, refCancelCB, self) => {
            ElectronIpcService.request(new IPCMessages.TimestampExtractRequest({
                session: this._guid,
                str: str,
                format: format,
                id: id,
                replacements: {
                    year: this.getDefaults().year,
                    month: this.getDefaults().month,
                    day: this.getDefaults().day,
                },
            }), IPCMessages.TimestampExtractResponse).then((response: IPCMessages.TimestampExtractResponse) => {
                if (typeof response.error === 'string') {
                    this._logger.error(`Fail to extract timestamp due error: ${response.error}`);
                    return reject(new Error(response.error));
                }
                resolve(response.timestamp);
            }).catch((disErr: Error) => {
                this._logger.error(`Fail to test files due error: ${disErr.message}`);
                return reject(disErr);
            });
        }).finally(() => {
            this._tasks.delete(id);
        });
        this._tasks.set(id, task);
        return task;
    }

    public isDetected(): boolean {
        return this._format.length > 0;
    }

    public getRangeIdByPosition(position: number): number {
        let id: number | undefined;
        this._ranges.forEach((r: IRange) => {
            if (id !== undefined) {
                return;
            }
            if (r.start.position === position) {
                id = r.id;
            } else if (r.end !== undefined && r.start.position < r.end.position && r.start.position <= position && r.end.position >= position) {
                id = r.id;
            } else if (r.end !== undefined && r.start.position > r.end.position && r.start.position >= position && r.end.position <= position) {
                id = r.id;
            }
        });
        return id;
    }

    public getCurrentGroup(): number | undefined {
        return this._sequences.group;
    }

    public getOpenRow(): IRow | undefined {
        return this._open === undefined ? undefined : Object.assign({}, this._open);
    }

    public getRanges(): IRange[] {
        return this._ranges.map((r: IRange) => {
            return Toolkit.copy(r);
        });
    }

    public getCount(): number {
        return this._ranges.length;
    }

    public getRangeColorFor(position: number): string | undefined {
        let color: string | undefined;
        this._ranges.forEach((r: IRange) => {
            if (color !== undefined) {
                return;
            }
            if (r.start.position === position) {
                color = r.color;
            } else if (r.end !== undefined && r.start.position < r.end.position && r.start.position <= position && r.end.position >= position) {
                color = r.color;
            } else if (r.end !== undefined && r.start.position > r.end.position && r.start.position >= position && r.end.position <= position) {
                color = r.color;
            }
        });
        return color;
    }

    public removeFormatDef(format: string) {
        this._format = this._format.filter(f => f.format !== format);
        this._subjects.formats.next();
        OutputParsersService.updateRowsView();
    }

    public addFormat(format: IFormat) {
        this._format.push(format);
        this._subjects.formats.next();
        OutputParsersService.updateRowsView();
    }

    public setDefaults(replacements: DefaultDateParts) {
        this._defaults = replacements;
        this._subjects.defaults.next(replacements);
    }

    public getDefaults(): DefaultDateParts {
        return this._defaults;
    }

    public setMode(mode: EChartMode) {
        this._mode = mode;
        this._subjects.mode.next(mode);
    }

    public getMode(): EChartMode {
        return this._mode;
    }

    public getMinTimestamp(): number {
        return Math.min(...this._ranges.map((range: IRange) => {
            if (range.end !== undefined) {
                return range.start.timestamp < range.end.timestamp ? range.start.timestamp : range.end.timestamp;
            } else {
                return range.start.timestamp;
            }
        }));
    }

    public getMaxTimestamp(): number {
        return Math.max(...this._ranges.map((range: IRange) => {
            if (range.end !== undefined) {
                return range.start.timestamp > range.end.timestamp ? range.start.timestamp : range.end.timestamp;
            } else {
                return range.start.timestamp;
            }
        }));
    }

    private _getTooltipContent(row: string, position: number, selection: string): Promise<string | undefined> {
        return new Promise((resolve) => {
            if (this._open === undefined) {
                return resolve(selection);
            }
            this.getTimestamp(selection).then((tm: number | undefined) => {
                resolve(`${Math.abs(this._open.timestamp - tm)}ms`);
            }).catch((err: Error) => {
                this._logger.error(`injectHighlight:: Fail get timestamp due error: ${err.message}`);
                resolve(undefined);
            });
        });
    }

    private _injectHighlightFormat(str: string): string {
        if (this._open === undefined) {
            return str;
        }
        this._format.forEach((format: IFormat) => {
            str = str.replace(format.regexp, (_match: string) => {
                return `<span class="tooltip timestampmatch" ${OutputParsersService.getTooltipHook(ROW_TOOLTIP_ID)}>${_match}</span>`;
            });
        });
        return str;
    }

    private _getColor(): string {
        return `rgb(${Math.round(Math.random() * 154) + 100}, ${Math.round(Math.random() * 154) + 100}, ${Math.round(Math.random() * 154) + 100})`;
    }

    private _setState() {
        this._state = { min: Infinity, max: -1, duration: 0 };
        this._ranges.forEach((r: IRange) => {
            if (this._state.min > r.start.timestamp) {
                this._state.min = r.start.timestamp;
            }
            if (this._state.max < r.start.timestamp) {
                this._state.max = r.start.timestamp;
            }
            if (r.end !== undefined) {
                if (this._state.min > r.end.timestamp) {
                    this._state.min = r.end.timestamp;
                }
                if (this._state.max < r.end.timestamp) {
                    this._state.max = r.end.timestamp;
                }
            }
        });
        this._state.duration = Math.abs(this._state.min - this._state.max);
    }

}