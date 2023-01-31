import { SetupLogger, LoggerInterface } from '@platform/entity/logger';
import { Subscriber, Subjects, Subject } from '@platform/env/subscription';
import { Owner, Row } from '@schema/content/row';
import { cutUuid } from '@log/index';
import { Bookmark } from './bookmark/bookmark';
import { Range } from '@platform/types/range';
import { Cursor } from './cursor';
import { hotkeys } from '@service/hotkeys';

import * as Requests from '@platform/ipc/request';

@SetupLogger()
export class Bookmarks extends Subscriber {
    public readonly subjects: Subjects<{
        updated: Subject<void>;
    }> = new Subjects({
        updated: new Subject<void>(),
    });
    private _uuid!: string;
    protected bookmarks: Bookmark[] = [];
    protected cursor!: Cursor;

    public init(uuid: string, cursor: Cursor) {
        this.setLoggerName(`Bookmarks: ${cutUuid(uuid)}`);
        this._uuid = uuid;
        this.cursor = cursor;
        this.register(
            hotkeys.listen('j', () => {
                this.move().prev();
            }),
        );
        this.register(
            hotkeys.listen('k', () => {
                this.move().next();
            }),
        );
    }

    public destroy() {
        this.unsubscribe();
        this.subjects.destroy();
    }

    public overwrite(bookmarks: Bookmark[], silence: boolean = false) {
        this.bookmarks = bookmarks;
        this.bookmarks.sort((a, b) => {
            return a.position < b.position ? -1 : 1;
        });
        !silence && this.update();
    }

    public bookmark(row: Row) {
        (() => {
            const exist = this.bookmarks.find((b) => b.position === row.position);
            if (exist) {
                return this.api()
                    .remove(row.position)
                    .then(() => {
                        this.bookmarks = this.bookmarks.filter((b) => b.position !== row.position);
                    });
            } else {
                return this.api()
                    .add(row.position)
                    .then(() => {
                        this.bookmarks.push(new Bookmark(row.position));
                    });
            }
        })()
            .then(() => {
                this.bookmarks.sort((a, b) => {
                    return a.position < b.position ? -1 : 1;
                });
                this.update();
            })
            .catch((err: Error) => {
                this.log().error(`Fail to bookmark: ${err.message}`);
            });
    }

    public is(stream: number): boolean {
        return this.bookmarks.find((b) => b.position === stream) !== undefined;
    }

    public count(): number {
        return this.bookmarks.length;
    }

    public get(range?: Range): Bookmark[] {
        if (range === undefined) {
            return this.bookmarks;
        } else {
            return this.bookmarks.filter((b) => range.in(b.position));
        }
    }

    public getRowsPositions(): number[] {
        return this.bookmarks.map((b) => b.position);
    }

    public hash(): string {
        return this.getRowsPositions().join(',');
    }

    public update(): void {
        this.subjects.get().updated.emit();
    }

    protected move(): {
        next(): void;
        prev(): void;
    } {
        const selected: number | undefined = (() => {
            if (this.bookmarks.length === 0) {
                return undefined;
            }
            const single = this.cursor.getSingle().position();
            if (single === undefined) {
                this.cursor.select(
                    this.bookmarks[0].position,
                    Owner.Bookmark,
                    undefined,
                    undefined,
                );
                return undefined;
            }
            return this.bookmarks.findIndex((b) => b.position === single);
        })();
        return {
            next: (): void => {
                if (selected === undefined) {
                    return;
                }
                if (selected === -1) {
                    this.cursor.select(
                        this.bookmarks[0].position,
                        Owner.Bookmark,
                        undefined,
                        undefined,
                    );
                    return;
                }
                if (selected === this.bookmarks.length - 1) {
                    return;
                }
                this.cursor.select(
                    this.bookmarks[selected + 1].position,
                    Owner.Bookmark,
                    undefined,
                    undefined,
                );
            },
            prev: (): void => {
                if (selected === undefined) {
                    return;
                }
                if (selected === -1) {
                    this.cursor.select(
                        this.bookmarks[this.bookmarks.length - 1].position,
                        Owner.Bookmark,
                        undefined,
                        undefined,
                    );
                    return;
                }
                if (selected === 0) {
                    return;
                }
                this.cursor.select(
                    this.bookmarks[selected - 1].position,
                    Owner.Bookmark,
                    undefined,
                    undefined,
                );
            },
        };
    }

    protected api(): {
        add(row: number): Promise<void>;
        remove(row: number): Promise<void>;
        set(rows: number[]): Promise<void>;
    } {
        return {
            add: (row: number): Promise<void> => {
                return Requests.IpcRequest.send(
                    Requests.Stream.AddBookmark.Response,
                    new Requests.Stream.AddBookmark.Request({
                        session: this._uuid,
                        row,
                    }),
                )
                    .then((response: Requests.Stream.AddBookmark.Response) => {
                        if (typeof response.error === 'string') {
                            this.log().error(
                                `Fail to add bookmark to position ${row}: ${response.error}`,
                            );
                        }
                    })
                    .catch((error: Error) => {
                        this.log().error(
                            `Fail to add bookmark to position ${row}: ${error.message}`,
                        );
                    });
            },
            remove: (row: number): Promise<void> => {
                return Requests.IpcRequest.send(
                    Requests.Stream.RemoveBookmark.Response,
                    new Requests.Stream.RemoveBookmark.Request({
                        session: this._uuid,
                        row,
                    }),
                )
                    .then((response: Requests.Stream.RemoveBookmark.Response) => {
                        if (typeof response.error === 'string') {
                            this.log().error(
                                `Fail to remove bookmark from position ${row}: ${response.error}`,
                            );
                        }
                    })
                    .catch((error: Error) => {
                        this.log().error(
                            `Fail to remove bookmark from position ${row}: ${error.message}`,
                        );
                    });
            },
            set: (rows: number[]): Promise<void> => {
                return Requests.IpcRequest.send(
                    Requests.Stream.SetBookmarks.Response,
                    new Requests.Stream.SetBookmarks.Request({
                        session: this._uuid,
                        rows,
                    }),
                )
                    .then((response: Requests.Stream.SetBookmarks.Response) => {
                        if (typeof response.error === 'string') {
                            this.log().error(
                                `Fail to remove bookmark from positions ${rows.join(', ')}: ${
                                    response.error
                                }`,
                            );
                        }
                    })
                    .catch((error: Error) => {
                        this.log().error(
                            `Fail to remove bookmark from positions ${rows.join(', ')}: ${
                                error.message
                            }`,
                        );
                    });
            },
        };
    }
}
export interface Bookmarks extends LoggerInterface {}
