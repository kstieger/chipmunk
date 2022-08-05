import { SetupService, Interface, Implementation, register } from '@platform/entity/service';
import { services } from '@register/services';
import { ilc, Emitter, Channel, Services } from '@service/ilc';
import { Session } from './session/session';
import { components } from '@env/decorators/initial';
import { TabControls } from './session/tab';
import { File } from '@platform/types/files';
import { IDLTOptions } from '@platform/types/parsers/dlt';
import { SourceDefinition } from '@platform/types/transport';
import { Vertical, Horizontal } from '@ui/service/popup';
import { getRenderFor } from '@schema/render/tools';
import { Progress } from '@ui/views/dialogs/progress/progress';

export { Session, TabControls };

@SetupService(services['opener'])
export class Service extends Implementation {
    private _emitter!: Emitter;
    private _channel!: Channel;
    private _services!: Services;

    public override ready(): Promise<void> {
        this._emitter = ilc.emitter(this.getName(), this.log());
        this._channel = ilc.channel(this.getName(), this.log());
        this._services = ilc.services(this.getName(), this.log());
        return Promise.resolve();
    }

    public stream(): {
        dlt(
            options?: { source: SourceDefinition; options: IDLTOptions },
            openPresetSettings?: boolean,
        ): Promise<void>;
        text(options?: { source: SourceDefinition }, openPresetSettings?: boolean): Promise<void>;
    } {
        const getProgress = () => {
            const progress = new Progress(true, 'creating stream...');
            return {
                progress,
                popup: this._services.ui.popup.open({
                    component: {
                        factory: components.get('app-dialogs-progress-message'),
                        inputs: {
                            progress,
                        },
                    },
                    position: {
                        vertical: Vertical.center,
                        horizontal: Horizontal.center,
                    },
                    closable: false,
                    width: 350,
                }),
            };
        };
        return {
            dlt: (
                options?: { source: SourceDefinition; options: IDLTOptions },
                openPresetSettings?: boolean,
            ): Promise<void> => {
                const open = (opt: {
                    source: SourceDefinition;
                    options: IDLTOptions;
                }): Promise<void> => {
                    return new Promise((resolve, reject) => {
                        this._services.system.session
                            .add()
                            .empty(getRenderFor().dlt())
                            .then((session) => {
                                session
                                    .connect(opt.source)
                                    .dlt(opt.options)
                                    .then(() => {
                                        this._services.system.recent
                                            .add()
                                            .stream(opt.source)
                                            .dlt(opt.options)
                                            .catch((err: Error) => {
                                                this.log().error(
                                                    `Fail to add recent action; error: ${err.message}`,
                                                );
                                            });
                                        resolve();
                                    })
                                    .catch((err: Error) => {
                                        this.log().error(`Fail to connect: ${err.message}`);
                                        reject(err);
                                    });
                            })
                            .catch((err: Error) => {
                                this.log().error(`Fail to create session: ${err.message}`);
                                reject(err);
                            });
                    });
                };
                return new Promise((resolve, reject) => {
                    if (options !== undefined && openPresetSettings !== true) {
                        open(options).then(resolve).catch(reject);
                    } else {
                        this._services.system.session.add().tab({
                            name: `DLT content streaming`,
                            content: {
                                factory: components.get('app-tabs-source-dltstream'),
                                inputs: {
                                    options: options,
                                    done: (
                                        options: {
                                            source: SourceDefinition;
                                            options: IDLTOptions;
                                        },
                                        cb: (err: Error | undefined) => void,
                                    ) => {
                                        open(options)
                                            .then(() => {
                                                resolve();
                                                cb(undefined);
                                            })
                                            .catch((err: Error) => {
                                                // We do not reject, but let component know - we are not able to observe
                                                cb(err);
                                            });
                                    },
                                },
                            },
                            active: true,
                        });
                    }
                });
            },
            text: (
                options?: { source: SourceDefinition },
                openPresetSettings?: boolean,
            ): Promise<void> => {
                let session: Session | undefined;
                const open = (
                    opt: { source: SourceDefinition },
                    bind: boolean,
                ): Promise<string> => {
                    return new Promise((resolve, reject) => {
                        this._services.system.session
                            .add(bind)
                            .empty(getRenderFor().text())
                            .then((created) => {
                                session = created;
                                session
                                    .connect(opt.source)
                                    .text()
                                    .then(() => {
                                        // this._services.system.recent
                                        //     .add()
                                        //     .stream(opt.source)
                                        //     .dlt(opt.options)
                                        //     .catch((err: Error) => {
                                        //         this.log().error(
                                        //             `Fail to add recent action; error: ${err.message}`,
                                        //         );
                                        //     });
                                        resolve(created.uuid());
                                    })
                                    .catch((err: Error) => {
                                        this.log().error(`Fail to connect: ${err.message}`);
                                        reject(err);
                                    });
                            })
                            .catch((err: Error) => {
                                this.log().error(`Fail to create session: ${err.message}`);
                                reject(err);
                            });
                    });
                };
                return new Promise((resolve, reject) => {
                    if (options !== undefined && openPresetSettings !== true) {
                        open(options, true)
                            .then(() => {
                                resolve();
                            })
                            .catch(reject);
                    } else {
                        this._services.system.session.add().tab({
                            name: `Text source streaming`,
                            content: {
                                factory: components.get('app-tabs-source-textstream'),
                                inputs: {
                                    options: options,
                                    done: (
                                        options: { source: SourceDefinition },
                                        cb: (err: Error | undefined) => void,
                                    ) => {
                                        const progress = getProgress();
                                        open(options, false)
                                            .then((session: string) => {
                                                progress.popup.close();
                                                this._services.system.session.bind(
                                                    session,
                                                    'Text Streaming',
                                                );
                                                resolve();
                                                cb(undefined);
                                            })
                                            .catch((err: Error) => {
                                                progress.progress
                                                    .set()
                                                    .message(err.message)
                                                    .type('error')
                                                    .spinner(false);
                                                session !== undefined &&
                                                    this._services.system.session.kill(
                                                        session.uuid(),
                                                    );
                                                // We do not reject, but let component know - we are not able to observe
                                                cb(err);
                                            });
                                    },
                                },
                            },
                            active: true,
                        });
                    }
                });
            },
        };
    }

    public file(file: File | string): {
        text(): Promise<void>;
        dlt(options?: IDLTOptions): Promise<void>;
    } {
        return {
            text: async (): Promise<void> => {
                const target =
                    typeof file === 'string'
                        ? (await this._services.system.bridge.files().getByPath([file]))[0]
                        : file;
                return new Promise((resolve, reject) => {
                    this._services.system.session
                        .add()
                        .file(
                            {
                                filename: target.filename,
                                name: target.name,
                                type: target.type,
                                options: {},
                            },
                            getRenderFor().text(),
                        )
                        .then(() => {
                            this._services.system.recent
                                .add()
                                .file(target, {})
                                .catch((err: Error) => {
                                    this.log().error(
                                        `Fail to add recent action; error: ${err.message}`,
                                    );
                                });
                            resolve();
                        })
                        .catch((err: Error) => {
                            this.log().error(`Fail to create session: ${err.message}`);
                            reject(err);
                        });
                });
            },
            dlt: async (options?: IDLTOptions): Promise<void> => {
                const target =
                    typeof file === 'string'
                        ? (await this._services.system.bridge.files().getByPath([file]))[0]
                        : file;
                const open = (opt: IDLTOptions): Promise<void> => {
                    return new Promise((resolve, reject) => {
                        this._services.system.session
                            .add()
                            .file(
                                {
                                    filename: target.filename,
                                    name: target.name,
                                    type: target.type,
                                    options: {
                                        dlt: opt,
                                    },
                                },
                                getRenderFor().dlt(),
                            )
                            .then(() => {
                                this._services.system.recent
                                    .add()
                                    .file(target, { dlt: opt })
                                    .catch((err: Error) => {
                                        this.log().error(
                                            `Fail to add recent action; error: ${err.message}`,
                                        );
                                    });
                                resolve();
                            })
                            .catch((err: Error) => {
                                this.log().error(`Fail to create session: ${err.message}`);
                                reject(err);
                            });
                    });
                };
                return new Promise((resolve, reject) => {
                    if (options !== undefined) {
                        open(options).then(resolve).catch(reject);
                    } else {
                        this._services.system.session.add().tab({
                            name: `Opening DLT file`,
                            content: {
                                factory: components.get('app-tabs-source-dltfile'),
                                inputs: {
                                    file,
                                    done: (opt: IDLTOptions) => {
                                        open(opt).then(resolve).catch(reject);
                                    },
                                },
                            },
                            active: true,
                        });
                    }
                });
            },
        };
    }
}
export interface Service extends Interface {}
export const opener = register(new Service());
