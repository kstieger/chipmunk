import { Base } from './action';
import { bridge } from '@service/bridge';
import { opener } from '@service/opener';
import { session } from '@service/session';
import { TabSourceMultipleFiles } from '@tabs/sources/multiplefiles/component';

export const ACTION_UUID = 'open_any_file';

export class Action extends Base {
    public group(): number {
        return 1;
    }
    public uuid(): string {
        return ACTION_UUID;
    }

    public caption(): string {
        return 'Open Any File(s)';
    }

    public async apply(): Promise<void> {
        const files = await bridge.files().select.any();
        if (files.length === 0) {
            return Promise.resolve();
        }
        if (files.length > 1) {
            session.add().tab({
                name: 'Multiple Files',
                active: true,
                closable: true,
                content: {
                    factory: TabSourceMultipleFiles,
                    inputs: { files: files },
                },
            });
            return Promise.resolve();
        }
        return opener.file(files[0]).text() as unknown as Promise<void>;
    }
}
