import { singleDecoratorFactory, DecoratorConstructor } from '@platform/env/decorators';
import { getComponentSelector } from '@env/reflect';

export class Components {
    private _components: Map<string, DecoratorConstructor> = new Map();

    public add(selector: string, constructor: DecoratorConstructor) {
        this._components.set(selector, constructor);
    }

    public get(selector: string): DecoratorConstructor {
        const target = this._components.get(selector);
        if (target === undefined) {
            throw new Error(`Fail to find initial component "${selector}"`);
        }
        return target;
    }
}

const components = new Components();

export const Initial = singleDecoratorFactory((constructor: DecoratorConstructor) => {
    const selector: string | undefined = getComponentSelector(constructor);
    if (selector === undefined) {
        console.log(constructor);
        throw new Error(`Fail to detect selector for angular component`);
    }
    components.add(selector, constructor);
    return class extends constructor {};
});

export { components };
