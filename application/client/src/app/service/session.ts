import { SetupService, Interface, Implementation, register } from '@platform/entity/service';
import { services } from '@register/services';
import { ilc, Emitter, Channel, Declarations, Services } from '@service/ilc';
import { TabsService, ITab } from '@elements/tabs/service';
import { Base } from './session/base';
import { Session } from './session/session';
import { UnboundTab } from './session/unbound';
import { LockToken } from '@platform/env/lock.token';
import { components } from '@env/decorators/initial';
import { TargetFile } from '@platform/types/files';
import { TabControls } from './session/tab';
import { unique } from '@platform/env/sequence';

import { Render } from '@schema/render';

export { Session, TabControls, UnboundTab, Base };

@SetupService(services['session'])
export class Service extends Implementation {
    private _emitter!: Emitter;
    private _channel!: Channel;
    private _services!: Services;
    private _active: Base | undefined;
    private _sessions: Map<string, Base> = new Map();
    private _tabs: TabsService = new TabsService();
    private _locker: LockToken = LockToken.simple(true);

    public override ready(): Promise<void> {
        this._emitter = ilc.emitter(this.getName(), this.log());
        this._channel = ilc.channel(this.getName(), this.log());
        this._services = ilc.services(this.getName(), this.log());
        this._channel.system.ready(() => {
            this.log().debug(`Session is unlocked`);
            this._locker.unlock();
        });
        this._channel.ux.hotkey(this._onHotKey.bind(this));
        this._tabs.getObservable().active.subscribe((next) => {
            this._active = this._sessions.get(next.uuid);
            this._emitter.session.change(
                this._active === undefined ? undefined : this._active.uuid(),
            );
        });
        this._tabs.getObservable().removed.subscribe((uuid) => {
            const session = this._sessions.get(uuid);
            if (session === undefined) {
                return;
            }
            session
                .destroy()
                .catch((err: Error) => {
                    this.log().error(`Fail to remove session: ${err.message}`);
                })
                .finally(() => {
                    this._sessions.delete(uuid);
                });
        });

        return Promise.resolve();
    }

    private _onHotKey(event: Declarations.HotkeyEvent) {
        console.log(`Not implemented: ${event}`);
        // if (this._active === undefined) {
        //     return;
        // }
        // const service: TabsService | undefined = this._sessions.get(this._active);
        // if (service === undefined) {
        //     return;
        // }
        // LayoutStateService.toolbarMax();
        // service.setActive(UUIDs.search);
    }

    public add(): {
        empty: (render: Render<unknown>) => Promise<Session>;
        file: (file: TargetFile, render: Render<unknown>) => Promise<Session>;
        unbound: (opts: {
            tab: ITab;
            sidebar?: boolean;
            toolbar?: boolean;
            uuid?: string;
        }) => UnboundTab;
        tab: (tab: ITab) => void;
    } {
        const binding = (uuid: string, session: Session, caption: string) => {
            this._sessions.set(uuid, session);
            session.bind(
                this._tabs.add({
                    uuid: uuid,
                    content: {
                        factory: components.get('app-views-workspace'),
                        inputs: {
                            session: session,
                        },
                    },
                    name: caption,
                    active: true,
                }),
            );
            this._emitter.session.change(uuid);
        };
        return {
            empty: (render: Render<unknown>): Promise<Session> => {
                if (this._locker.isLocked()) {
                    return Promise.reject(new Error(`Sessions aren't available yet`));
                }
                return new Promise((resolve, reject) => {
                    const session = new Session(render);
                    session
                        .init({})
                        .then((uuid: string) => {
                            binding(uuid, session, 'Empty');
                            resolve(session);
                        })
                        .catch((err: Error) => {
                            this.log().error(`Fail to add session; error: ${err.message}`);
                            reject(err);
                        });
                });
            },
            file: (file: TargetFile, render: Render<unknown>): Promise<Session> => {
                if (this._locker.isLocked()) {
                    return Promise.reject(new Error(`Sessions aren't available yet`));
                }
                return new Promise((resolve, reject) => {
                    const session = new Session(render);
                    session
                        .init({
                            file,
                        })
                        .then((uuid: string) => {
                            binding(uuid, session, file.name);
                            resolve(session);
                        })
                        .catch((err: Error) => {
                            this.log().error(`Fail to add session; error: ${err.message}`);
                            reject(err);
                        });
                });
            },
            tab: (tab: ITab): void => {
                if (tab.content !== undefined) {
                    tab.content.inputs = tab.content.inputs === undefined ? {} : tab.content.inputs;
                    tab.content.inputs.tab = new TabControls(tab, this._tabs);
                }
                this._tabs.add(tab);
            },
            unbound: (opts: {
                tab: ITab;
                sidebar?: boolean;
                toolbar?: boolean;
                uuid?: string;
            }): UnboundTab => {
                if (opts.uuid !== undefined && this._sessions.has(opts.uuid)) {
                    throw new Error(this.log().error(`Tab "${opts.uuid}" already exists`));
                }
                opts.uuid = opts.uuid !== undefined ? opts.uuid : unique();
                opts.tab.uuid = opts.tab.uuid !== undefined ? opts.tab.uuid : opts.uuid;
                const unbound = new UnboundTab(opts);
                this._sessions.set(unbound.uuid(), unbound);
                unbound.bind(this._tabs.add(opts.tab));
                return unbound;
            },
        };
    }

    public getTabsService(): TabsService {
        return this._tabs;
    }

    public active(): {
        base(): Base | undefined;
        session(): Session | undefined;
        unbound(): UnboundTab | undefined;
    } {
        return {
            base: (): Base | undefined => {
                return this._active;
            },
            session: (): Session | undefined => {
                return this._active instanceof Session ? this._active : undefined;
            },
            unbound: (): UnboundTab | undefined => {
                return this._active instanceof UnboundTab ? this._active : undefined;
            },
        };
    }
}
export interface Service extends Interface {}
export const session = register(new Service());