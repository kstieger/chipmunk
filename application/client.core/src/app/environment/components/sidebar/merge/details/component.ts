import { Component, OnDestroy, ChangeDetectorRef, Input, OnChanges, AfterContentInit, AfterViewInit, SimpleChanges, ViewEncapsulation } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subscription, Observable, Subject } from 'rxjs';
import { ControllerFileMergeSession, IMergeFile, IFileOptions } from '../../../../controller/controller.file.merge.session';
import { CColors } from '../../../../conts/colors';
import { getContrastColor } from '../../../../theme/colors';

import * as Toolkit from 'chipmunk.client.toolkit';

enum EFormatState {
    requiredtest = 'requiredtest',
    tested = 'tested',
    testing = 'testing',
}

const CKeyValueChar = '\u0007';
const CKeyStyleChar = '\u0008';

const CGroupsNames = {
    timezone: 'timezone',
    d: 'd',
    m: 'm',
    MMM: 'MMM',
    Y: 'Y',
    y: 'y',
    H: 'H',
    M: 'M',
    S: 'S',
    millis: 'millis',
    am_pm: 'am_pm',
};

const CGroupsHooks: { [group: string]: RegExp[] } = {
    [CGroupsNames.timezone]:   [/TZD/g],
    [CGroupsNames.d]:          [/DD/g],
    [CGroupsNames.m]:          [/MM/g],
    [CGroupsNames.MMM]:        [/MMM/g],
    [CGroupsNames.Y]:          [/YYYY/g],
    [CGroupsNames.y]:          [/yy/g],
    [CGroupsNames.H]:          [/hh/g],
    [CGroupsNames.M]:          [/mm/g],
    [CGroupsNames.S]:          [/ss/g],
    [CGroupsNames.millis]:     [/\.s(?!s)/g],
    [CGroupsNames.am_pm]:      [/a/g],
};

const CGroupsStyles: { [group: string]: string } = {
    [CGroupsNames.timezone]:   `background: ${CColors[4]};color: ${getContrastColor(CColors[4], true)}`,
    [CGroupsNames.d]:          `background: ${CColors[6]};color: ${getContrastColor(CColors[6], true)}`,
    [CGroupsNames.m]:          `background: ${CColors[8]};color: ${getContrastColor(CColors[8], true)}`,
    [CGroupsNames.MMM]:        `background: ${CColors[10]};color: ${getContrastColor(CColors[10], true)}`,
    [CGroupsNames.Y]:          `background: ${CColors[12]};color: ${getContrastColor(CColors[12], true)}`,
    [CGroupsNames.y]:          `background: ${CColors[14]};color: ${getContrastColor(CColors[14], true)}`,
    [CGroupsNames.H]:          `background: ${CColors[16]};color: ${getContrastColor(CColors[16], true)}`,
    [CGroupsNames.M]:          `background: ${CColors[18]};color: ${getContrastColor(CColors[18], true)}`,
    [CGroupsNames.S]:          `background: ${CColors[20]};color: ${getContrastColor(CColors[20], true)}`,
    [CGroupsNames.millis]:     `background: ${CColors[22]};color: ${getContrastColor(CColors[22], true)}`,
    [CGroupsNames.am_pm]:      `background: ${CColors[24]};color: ${getContrastColor(CColors[24], true)}`,
};

@Component({
    selector: 'app-sidebar-app-files-details',
    templateUrl: './template.html',
    styleUrls: ['./styles.less'],
    encapsulation: ViewEncapsulation.None
})

export class SidebarAppMergeFilesDetailsComponent implements OnDestroy, AfterContentInit, AfterViewInit, OnChanges {

    @Input() public controller: ControllerFileMergeSession;
    @Input() public file: IMergeFile;

    public _ng_preview: SafeHtml[] = [];
    public _ng_format: string = '';
    public _ng_state: EFormatState = EFormatState.tested;
    public _ng_year: string = '';
    public _ng_offset: number = 0;

    private _subscriptions: { [key: string]: Subscription } = {};
    private _destroyed: boolean = false;

    constructor(private _sanitizer: DomSanitizer, private _cdRef: ChangeDetectorRef) {
    }

    public ngAfterContentInit() {
        this._setPreview();
        this._setFormat();
    }

    public ngAfterViewInit() {
    }

    public ngOnDestroy() {
        this._destroyed = true;
        Object.keys(this._subscriptions).forEach((key: string) => {
            this._subscriptions[key].unsubscribe();
        });
    }

    public ngOnChanges(changes: SimpleChanges) {
        if (changes.file === undefined) {
            return;
        }
        if (changes.file.previousValue !== undefined && changes.file.previousValue.path === this.file.path) {
            return;
        }
        this._setPreview(changes.file.currentValue);
    }

    public _ng_onFormatChange() {
        if (this.file.format === undefined) {
            this._ng_state = EFormatState.requiredtest;
            return;
        }
        if (this.file.format.format === this._ng_format) {
            this._ng_state = EFormatState.tested;
        } else {
            this._ng_state = EFormatState.requiredtest;
        }
    }

    public _ng_onApply() {
        if (this.file.format === undefined || this.file.format.format === this._ng_format) {
            return;
        }
        this.file.format.format = this._ng_format;
        this.controller.update(this.file.path, this.file);
    }

    public _ng_getFormatStr(): SafeHtml {
        if (this._ng_format.trim() === '') {
            return this._sanitizer.bypassSecurityTrustHtml('');
        }
        let html: string = this._ng_format;
        let key: string = CKeyValueChar;
        const values: { [key: string]: string } = {};
        const styles: { [key: string]: string } = {};
        Object.keys(CGroupsStyles).forEach((group: string) => {
            if (CGroupsHooks[group] instanceof Array) {
                CGroupsHooks[group].forEach((reg: RegExp) => {
                    styles[key] = CGroupsStyles[group];
                    html = html.replace(reg, (match: string) => {
                        values[key] = match;
                        return key;
                    });
                    key += CKeyValueChar;
                });
            }
        });
        Object.keys(values).reverse().forEach((vKey: string) => {
            html = html.replace(vKey, `<span style="${styles[vKey]}">${values[vKey]}</span>`);
        });
        return this._sanitizer.bypassSecurityTrustHtml(html);
    }

    public _ng_onYearChange() {
        this.controller.setOptions(this.file.path, this._getOptions());
    }

    public _ng_onOffsetChange() {
        this.controller.setOptions(this.file.path, this._getOptions());
    }

    private _getOptions(): IFileOptions {
        function getNum(str: string | number): number | undefined {
            if (typeof str === 'string' && str.trim() === '') {
                return undefined;
            }
            const num: number = typeof str === 'string' ? parseInt(str, 10) : str;
            if (isNaN(num) || !isFinite(num) || num < 0) {
                return undefined;
            } else {
                return num;
            }
        }
        return {
            year: getNum(this._ng_year),
            offset: getNum(this._ng_offset),
        };
    }

    private _setOptions() {
        this._ng_year = '';
        this._ng_offset = undefined;
        if (this.file.options === undefined) {
            return;
        }
        if (this.file.options.year !== undefined) {
            this._ng_year = this.file.options.year.toString();
        }
        if (this.file.options.offset !== undefined) {
            this._ng_offset = this.file.options.offset;
        }
    }

    private _setPreview(file?: IMergeFile) {
        if (file === undefined) {
            file = this.file;
        }
        if (this.file.info === undefined || typeof this.file.info.preview !== 'string') {
            this._ng_preview = [];
        } else {
            let stampregexp: RegExp | Error | undefined;
            if (this.file.format !== undefined && Toolkit.regTools.isRegStrValid(this.file.format.regex)) {
                stampregexp = Toolkit.regTools.createFromStr(this.file.format.regex);
            }
            this._ng_preview = this.file.info.preview.split(/[\n\r]/gi).filter((row: string) => row.trim() !== '').map((row: string) => {
                row = row.replace(/</gi, '&lt;').replace(/>/gi, '&gt;');
                if (stampregexp instanceof RegExp) {
                    const matches: RegExpMatchArray | null = row.match(stampregexp);
                    if (matches !== null && matches.length !== 0) {
                        Array.prototype.forEach.call(matches, (match: string) => {
                            const stamp: string = stampregexp instanceof RegExp ? this._getGrouppedStr(stampregexp, match, (group: string) => {
                                return CGroupsStyles[group];
                            }) : match;
                            row = row.replace(match, '<span class="match">' + stamp + '</span>');
                        });
                    }
                }
                return this._sanitizer.bypassSecurityTrustHtml(row);
            });
        }
    }

    private _getGrouppedStr(regexp: RegExp, str: string, cb: (group: string) => string) {
        regexp.lastIndex = 0;
        let sValue: string = CKeyValueChar;
        let sStyle: string = CKeyStyleChar;
        const values: { [key: string]: string } = {};
        const styles: { [key: string]: string } = {};
        const exec: RegExpExecArray = regexp.exec(str);
        Object.keys(exec.groups).forEach((group: string) => {
            values[sValue] = exec.groups[group];
            styles[sStyle] = cb(group);
            str = str.replace(exec.groups[group], '<span class="group" style="' + sStyle + '">' + sValue + '</span>');
            sValue += CKeyValueChar;
            sStyle += CKeyStyleChar;
        });
        Object.keys(values).reverse().forEach((key: string) => {
            str = str.replace(key, values[key]);
        });
        Object.keys(styles).reverse().forEach((key: string) => {
            str = str.replace(key, styles[key]);
        });
        return str;
    }

    private _setFormat() {
        if (this.file.format === undefined) {
            this._ng_format = '';
        } else {
            this._ng_format = this.file.format.format;
        }
    }

    private _forceUpdate() {
        if (this._destroyed) {
            return;
        }
        this._cdRef.detectChanges();
    }

}
