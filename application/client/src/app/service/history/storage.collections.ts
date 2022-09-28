import { bridge } from '@service/bridge';
import { Collections } from './collections';
import { SetupLogger, LoggerInterface } from '@platform/entity/logger';
import { error } from '@platform/env/logger';
import { Definition } from './definition';
import { StorageDefinitions } from './storage.definitions';
import { Suitable } from './suitable';

@SetupLogger()
export class StorageCollections {
    static UUID = 'history_collections_storage';
    protected collections: Map<string, Collections> = new Map();
    protected definitions: StorageDefinitions;

    constructor(definitions: StorageDefinitions) {
        this.setLoggerName(`StorageCollections`);
        this.definitions = definitions;
    }

    public async load(): Promise<void> {
        this.collections.clear();
        await bridge
            .entries(StorageCollections.UUID)
            .get()
            .then((entries) => {
                entries.forEach((entry) => {
                    try {
                        const collections = Collections.from(entry, this);
                        this.collections.set(collections.uuid, collections);
                    } catch (e) {
                        this.log().error(`Fail parse collection: ${error(e)}`);
                    }
                });
            })
            .catch((err: Error) => {
                this.log().warn(`Fail to read history collections: ${err.message}`);
            });
    }

    public async save(): Promise<void> {
        await bridge
            .entries(StorageCollections.UUID)
            .overwrite(Array.from(this.collections.values()).map((c) => c.entry().to()))
            .catch((err: Error) => {
                this.log().warn(`Fail to write history collections: ${err.message}`);
            });
    }

    public update(collections: Collections): string | undefined {
        const existed = Array.from(this.collections.values()).find((c) => c.isSame(collections));
        if (this.collections.has(collections.uuid) || existed === undefined) {
            this.collections.set(collections.uuid, collections);
            return undefined;
        }
        return existed.uuid;
    }

    public delete(collections: Collections) {
        this.collections.delete(collections.uuid);
        this.save();
    }

    public clear() {
        this.collections.clear();
        this.save();
    }

    public find(definitions: Definition[]): {
        related(): Collections[];
        suitable(): Suitable;
    } {
        return {
            related: (): Collections[] => {
                return Array.from(this.collections.values()).filter((collections) => {
                    return definitions.filter((def) => def.check().related(collections)).length > 0;
                });
            },
            suitable: (): Suitable => {
                const suitable: Suitable = new Suitable();
                Array.from(this.collections.values()).forEach((collections) => {
                    collections.relations.forEach((uuid) => {
                        const definition = this.definitions.get(uuid);
                        if (definition === undefined) {
                            return;
                        }
                        definitions.forEach((def) => {
                            suitable.add(collections, def.check().suitable(definition));
                        });
                    });
                });
                return suitable;
            },
        };
    }

    public used(uuid: string) {
        const collection = this.collections.get(uuid);
        if (collection === undefined) {
            return;
        }
        collection.used += 1;
        collection.last = Date.now();
    }
}
export interface StorageCollections extends LoggerInterface {}