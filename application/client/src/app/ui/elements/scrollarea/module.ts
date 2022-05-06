import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ScrollAreaComponent } from './component';
import { ScrollAreaVerticalComponent } from './vertical/component';
import { RowModule } from './row/module';

export { ScrollAreaComponent };

const entryComponents = [ScrollAreaComponent, ScrollAreaVerticalComponent];
const components = [...entryComponents];

@NgModule({
    entryComponents: [...entryComponents],
    imports: [CommonModule, RowModule],
    declarations: [...components],
    exports: [...components],
})
export class ScrollAreaModule {
    constructor() {}
}
