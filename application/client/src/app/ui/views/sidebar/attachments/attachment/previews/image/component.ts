import {
    Component,
    Input,
    ViewChild,
    AfterViewInit,
    ElementRef,
    ChangeDetectorRef,
    ChangeDetectionStrategy,
    AfterContentInit,
} from '@angular/core';
import { ChangesDetector } from '@ui/env/extentions/changes';
import { Ilc, IlcInterface } from '@env/decorators/component';
import { Attachment } from '@platform/types/content';
import { popup, Vertical, Horizontal } from '@ui/service/popup';
import { ChangeEvent } from '@directives/dragging';
import { stop } from '@ui/env/dom';

@Component({
    selector: 'app-views-attachments-item-image-preview',
    templateUrl: './template.html',
    styleUrls: ['./styles.less'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
@Ilc()
export class Preview extends ChangesDetector implements AfterViewInit, AfterContentInit {
    @Input() attachment!: Attachment;
    @Input() maximizible: boolean = true;

    @ViewChild('image') public imageElRef!: ElementRef<HTMLImageElement>;

    public url!: string;

    protected rotation: number = 0;
    protected zoom: number = 1;
    protected size!: DOMRect;
    protected origin!: DOMRect;

    protected readonly position: {
        top: number;
        left: number;
    } = {
        top: 0,
        left: 0,
    };

    protected readonly min: {
        top: number;
        left: number;
    } = {
        top: 0,
        left: 0,
    };

    protected readonly max: {
        top: number;
        left: number;
    } = {
        top: 0,
        left: 0,
    };

    constructor(cdRef: ChangeDetectorRef) {
        super(cdRef);
    }

    protected updateImageDomRect() {
        this.size = this.imageElRef.nativeElement.getBoundingClientRect();
        const diff = {
            top: (this.size.height - this.origin.height) / 2 / this.zoom,
            left: (this.size.width - this.origin.width) / 2 / this.zoom,
        };
        if (diff.top > 0) {
            this.max.top = diff.top;
            this.min.top = -diff.top;
        } else {
            this.max.top = 0;
            this.min.top = 0;
        }
        if (diff.left > 0) {
            this.max.left = diff.left;
            this.min.left = -diff.left;
        } else {
            this.max.left = 0;
            this.min.left = 0;
        }
        if (this.position.top > this.max.top) {
            this.position.top = this.max.top;
        } else if (this.position.top < this.min.top) {
            this.position.top = this.min.top;
        }
        if (this.position.left > this.max.left) {
            this.position.left = this.max.left;
        } else if (this.position.left < this.min.left) {
            this.position.left = this.min.left;
        }
    }

    public originImageDomRect() {
        this.origin = this.imageElRef.nativeElement.getBoundingClientRect();
        this.updateImageDomRect();
    }

    public ngAfterContentInit(): void {
        this.url = `attachment://${this.attachment.filepath}`;
    }

    public ngAfterViewInit(): void {
        this.originImageDomRect();
        this.size = this.origin;
    }

    public getStyles(): { [key: string]: string } {
        return {
            transform: `rotate(${this.rotation}deg) scale(${this.zoom}) translate(${this.position.left}px,${this.position.top}px)`,
        };
    }

    public rotate(): {
        left(): void;
        right(): void;
    } {
        return {
            left: (): void => {
                this.rotation -= 90;
                this.rotation = this.rotation < 0 ? 270 : this.rotation;
            },
            right: (): void => {
                this.rotation += 90;
                this.rotation = this.rotation > 360 ? 90 : this.rotation;
            },
        };
    }

    public scrolling(event: WheelEvent) {
        stop(event);
        this.zoom += 0.05 * (event.deltaY > 0 ? -1 : 1);
        this.zoom = this.zoom < 1 ? 1 : this.zoom;
        this.detectChanges();
        this.updateImageDomRect();
    }

    public maximize() {
        popup.open({
            component: {
                factory: Preview,
                inputs: {
                    attachment: this.attachment,
                    maximizible: false,
                },
            },
            position: {
                vertical: Vertical.center,
                horizontal: Horizontal.center,
            },
            closeOnKey: 'Escape',
            uuid: this.attachment.uuid,
        });
    }

    public move(event: ChangeEvent) {
        this.position.top = event.top;
        this.position.left = event.left;
    }
}
export interface Preview extends IlcInterface {}
