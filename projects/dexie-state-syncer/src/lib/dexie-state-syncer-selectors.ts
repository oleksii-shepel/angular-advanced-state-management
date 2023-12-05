export type AnyFn = (...args: any[]) => any;

export interface SelectorFunction {
  (state: any, props: any): any;
}

export interface ProjectorFunction {
  (state: any | any[], props: any): any;
}

export interface MemoizedFunction {
  (...args: any[]): any;
  release: () => any;
}

export interface MemoizedSelectorFunction extends MemoizedFunction, SelectorFunction {

}

export interface MemoizedProjectorFunction extends MemoizedFunction, ProjectorFunction {

}

export interface MemoizedSelector extends MemoizedFunction {
  (props: any | any[], projectorProps?: any): Promise<(state: any) => any> | any;
  release: () => any;
}


const defaultMemoize: AnyFn = (fn: AnyFn): MemoizedFunction => {
  let lastArgs: any[] | undefined = undefined;
  let lastResult: any | undefined = undefined;
  let called = false;

  const resultFunc: MemoizedFunction = async (...args: any[]): Promise<any> => {
    if (called && lastArgs !== undefined && args.length === lastArgs.length) {
      let argsEqual = true;
      for (let i = 0; i < args.length; i++) {
        if (args[i] !== lastArgs[i]) {
          argsEqual = false;
          break;
        }
      }
      if (argsEqual) {
        return lastResult;
      }
    }

    try {
      const result = await fn(...args);
      lastResult = result;
      lastArgs = args;
      called = true;
      return result;
    } catch (error) {
      // Handle error here
      throw error;
    }
  };

  resultFunc.release = () => {
    lastArgs = undefined;
    lastResult = undefined;
    called = false;
  };

  return resultFunc;
};

function asyncMemoize(fn: AnyFn): MemoizedFunction {
  const cache = new Map<string, Promise<any>>();

  const memoizedFn: MemoizedFunction = (...args: any[]) => {
    const key = args.join(':');

    if (cache.has(key)) {
      return cache.get(key);
    }

    const promise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Function execution timed out'));
      }, 5000); // Timeout after 5 seconds

      try {
        const result = fn(...args);
        clearTimeout(timeout);
        cache.set(key, Promise.resolve(result));
        resolve(result);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });

    cache.set(key, promise);
    return promise;
  };

  memoizedFn.release = () => {
    cache.clear();
  };

  return memoizedFn;
}

export function memoizeStub(fn: AnyFn) {
  const func = (...args: any[]) => fn(...args);
  func.release = () => { Function.prototype };
  return func;
}

export function createSelector(
  selectors: SelectorFunction | SelectorFunction[],
  projector: ProjectorFunction,
  options: { memoizeSelectors?: AnyFn; memoizeProjector?: AnyFn } = {}
): MemoizedSelector {
  const { memoizeSelectors = asyncMemoize, memoizeProjector = defaultMemoize } = options;

  const isSelectorArray = Array.isArray(selectors);
  const selectorArray: SelectorFunction[] = isSelectorArray ? selectors : [selectors];

  const memoizedSelectors: MemoizedFunction[] = [];
  for (const selector of selectorArray) {
    memoizedSelectors.push(memoizeSelectors(selector));
  }

  const memoizedProjector: MemoizedFunction = memoizeProjector(projector);

  const memoizedSelector: MemoizedSelector = async (state: any, props?: any) => {
    const selectorPromises = memoizedSelectors.map(selector => selector(state, props));
    let selectorResults = await Promise.allSettled(selectorPromises) as any;
    selectorResults = selectorResults.map(({status, value}: any) => value);
    return memoizedProjector(...selectorResults, props);
  };

  memoizedSelector.release = () => {
    memoizedSelectors.forEach(selector => selector.release());
    memoizedProjector.release();
  };

  return memoizedSelector;
}

