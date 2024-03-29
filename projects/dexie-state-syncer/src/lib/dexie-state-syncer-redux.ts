import { Observable, Observer, ReplaySubject, Subscription, UnaryFunction, concatMap, from, isObservable, of, scan, tap } from "rxjs";
import { Action, AsyncAction } from "./dexie-state-syncer-actions";
import { AsyncObserver, CustomAsyncSubject, toObservable } from "./dexie-state-syncer-behaviour-subject";
import { AnyFn } from "./dexie-state-syncer-selectors";

function isAction(action: any): boolean {
  return isPlainObject(action) && "type" in action && typeof action.type === "string";
}

function isPlainObject(obj: any): boolean {
  if (typeof obj !== "object" || obj === null)
    return false;

  let proto = obj;
  while (Object.getPrototypeOf(proto) !== null) {
    proto = Object.getPrototypeOf(proto);
  }

  return Object.getPrototypeOf(obj) === proto;
}

const randomString = (): string => Math.random().toString(36).substring(7).split("").join(".");

const ActionTypes = {
  INIT: `@@redux/INIT${/* @__PURE__ */ randomString()}`,
  REPLACE: `@@redux/REPLACE${/* @__PURE__ */ randomString()}`,
  PROBE_UNKNOWN_ACTION: (): string => `@@redux/PROBE_UNKNOWN_ACTION${randomString()}`
};

const actionTypes_default = ActionTypes;

function kindOf(val: any): string {
  if (val === undefined)
    return "undefined";
  if (val === null)
    return "null";

  const type = typeof val;
  switch (type) {
    case "boolean":
    case "string":
    case "number":
    case "symbol":
    case "function": {
      return type;
    }
  }

  if (Array.isArray(val))
    return "array";

  if (isDate(val))
    return "date";

  if (isError(val))
    return "error";

  const constructorName = ctorName(val);
  switch (constructorName) {
    case "Symbol":
    case "Promise":
    case "WeakMap":
    case "WeakSet":
    case "Map":
    case "Set":
      return constructorName;
  }

  return Object.prototype.toString.call(val).slice(8, -1).toLowerCase().replace(/\s/g, "");
}

function ctorName(val: any): string {
  return typeof val.constructor === "function" ? val.constructor.name : null;
}

function isError(val: any): boolean {
  return val instanceof Error || typeof val.message === "string" && val.constructor && typeof val.constructor.stackTraceLimit === "number";
}

function isDate(val: any): boolean {
  if (val instanceof Date)
    return true;

  return typeof val.toDateString === "function" && typeof val.getDate === "function" && typeof val.setDate === "function";
}

export type Reducer = (state: any, action: Action<any>) => any


export type SideEffect = () => (Generator<Promise<any>, any, any> | AsyncGenerator<Promise<any>, any, any>);


export interface FeatureModule {
  slice: string;
  state: any;
  reducer: Reducer;
  effects: SideEffect[];
}

export interface MainModule {
  transformers: MiddlewareOperator[];
  processors: MiddlewareOperator[];
  reducers: Record<string, Reducer>;
  effects: SideEffect[];
}

export interface Store {
  dispatch: (action: AsyncAction<any> | Action<any> | (() => AsyncGenerator<Promise<any>, any, any>) | (() => Generator<Promise<any>, any, any>)) => any;
  getState: () => any;
  replaceReducer: (newReducer: Reducer) => void;
  pipe: (...operators: Array<UnaryFunction<Observable<any>, Observable<any>>>) => Observable<any>;
  subscribe: (next?: AnyFn | Observer<any>, error?: AnyFn, complete?: AnyFn) => Promise<Subscription>;
  subscription: Subscription;
  pipeline: {
    transformers: (action: Action<any> | AsyncAction<any>) => any;
    processors: (action: Action<any> | AsyncAction<any>) => any;
    reducer: Reducer;
    effects: SideEffect[];
  };
  mainModule: MainModule;
  modules: FeatureModule[];
  actionStream: ReplaySubject<Observable<Action<any>> | AsyncAction<any>>;
  currentState: CustomAsyncSubject<any>;
  isDispatching: boolean;
}

const actions = {
  INIT_STORE: 'INIT_STORE',
  LOAD_MODULE: 'LOAD_MODULE',
  UNLOAD_MODULE: 'UNLOAD_MODULE',
  ENABLE_TRANSFORMERS: 'ENABLE_TRANSFORMERS',
  SETUP_PROCESSORS: 'SETUP_PROCESSORS',
  REGISTER_EFFECTS: 'REGISTER_EFFECTS',
  UNREGISTER_EFFECTS: 'UNREGISTER_EFFECTS'
};

// Define the action creators
const actionCreators = {
  initStore: (module: MainModule) => ({ type: actions.INIT_STORE, payload: module }),
  loadModule: (module: FeatureModule) => ({ type: actions.LOAD_MODULE, payload: module }),
  unloadModule: (module: FeatureModule) => ({ type: actions.UNLOAD_MODULE, payload: module }),
  setupTransformers: () => ({ type: actions.ENABLE_TRANSFORMERS }),
  setupProcessors: () => ({ type: actions.SETUP_PROCESSORS }),
  registerEffects: () => ({ type: actions.REGISTER_EFFECTS }),
  unregisterEffects: () => ({ type: actions.UNREGISTER_EFFECTS, payload: module}),
};

// Define the reducer
export function supervisor(mainModule: MainModule) {
  return (storeCreator: StoreCreator) => (reducer: Reducer, preloadedState?: any, enhancer?: StoreEnhancer) => {
    // Create the store as usual
    let store = storeCreator.store as any;

    // If store is not already initialized, initialize it
    if (!store) {
      store = storeCreator.store = storeCreator(reducer, preloadedState, enhancer);
    }

    // Enhance the dispatch function
    const originalDispatch = store.dispatch;
    store.dispatch = (action: Action<any> | AsyncAction<any> | (() => AsyncGenerator<Promise<any>, any, any>) | (() => Generator<Promise<any>, any, any>)) => {

      // Handle Action
      let result = originalDispatch(action);

      action = action as Action<any>;
      if(action?.type) {
        // Handle specific actions
        switch (action.type) {
          case actions.INIT_STORE:
            store.mainModule = { ...store.mainModule, ...action.payload };
            break;
          case actions.LOAD_MODULE:
            store = loadModule(store, action.payload);
            break;
          case actions.UNLOAD_MODULE:
            store = unloadModule(store, action.payload);
            break;
          case actions.ENABLE_TRANSFORMERS:
            store.pipeline.transformers = setupTransformers(store);
            break;
          case actions.SETUP_PROCESSORS:
            store.pipeline.processors = setupProcessors(store);
            break;
          case actions.REGISTER_EFFECTS:
            store.pipeline.effects = registerEffects(store);
            break;
          case actions.UNREGISTER_EFFECTS:
            store.pipeline.effects = unregisterEffects(store, action.payload);
            break;
          default:
            break;
        }
      }

      return result;
    };

    // Initialize the store with the main module
    store.dispatch(actionCreators.initStore(mainModule));
    store.dispatch(actionCreators.setupTransformers());
    store.dispatch(actionCreators.setupProcessors());
    store.dispatch(actionCreators.registerEffects());

    return store;
  };
}

interface StoreCreator extends Function {
  (reducer: Reducer, preloadedState?: any, enhancer?: StoreEnhancer): Store;
  store?: Store;
}

export type StoreEnhancer = (next: StoreCreator) => StoreCreator;


const createStore: any = function (reducer: Reducer, preloadedState?: any, enhancer?: StoreEnhancer): Store {

  let store = createStore.store;

  if (typeof reducer !== "function") {
    throw new Error(`Expected the root reducer to be a function. Instead, received: '${kindOf(reducer)}'`);
  }

  if ((typeof preloadedState === "function" && typeof enhancer === "function") || (typeof enhancer === "function" && typeof arguments[3] === "function")) {
    throw new Error("It looks like you are passing several store enhancers to createStore(). This is not supported. Instead, compose them together to a single function. See https://redux.js.org/tutorials/fundamentals/part-4-store#creating-a-store-with-enhancers for an example.");
  }

  if (typeof preloadedState === "function" && typeof enhancer === "undefined") {
    enhancer = preloadedState;
    preloadedState = undefined;
  }

  // If store is not already initialized, initialize it
  if (!store) {
    store = createStore.store = { dispatch, getState, replaceReducer, pipe, subscribe, pipeline: {}, mainModule: { transformers: [], processors: [], reducer: (state: any, action: Action<any>) => state, effects: [] }, modules: [] } as any;

    store.pipeline.transformers = ((action: any) => action);
    store.pipeline.processors = ((action: any) => action);
    store.pipeline.reducer = ((state: any, action: Action<any>) => state);
    store.pipeline.effects = [];

    store.actionStream = new ReplaySubject<Observable<Action<any>> | AsyncAction<any>>();
    store.currentState = new CustomAsyncSubject<any>(preloadedState);
    store.isDispatching = false;
  }

  dispatch({
    type: actionTypes_default.INIT
  });

  if (typeof enhancer !== "undefined") {
    if (typeof enhancer !== "function") {
      throw new Error(`Expected the enhancer to be a function. Instead, received: '${kindOf(enhancer)}'`);
    }
    store = {...store, ...enhancer(createStore)(reducer, preloadedState)};
  }

  const subscription = store.actionStream.pipe(
    concatMap(action => from(store.pipeline.transformers(action))),
    concatMap(action => store.pipeline.processors(action)),
    tap(() => store.isDispatching = true),
    scan((state, action: any) => store.pipeline.reducer(state, action), store.currentState.value),
    concatMap((state: any) => from(store.currentState.next(state))),
    tap(() => store.isDispatching = false)
  ).subscribe();


  function getState(): any {
    return store.currentState.value;
  }

  function subscribe(next?: AnyFn | Observer<any>, error?: AnyFn, complete?: AnyFn): Subscription {
    if (typeof next === 'function') {
      return store.currentState.subscribe({next, error, complete});
    } else {
      return store.currentState.subscribe(next as Partial<AsyncObserver<any>>);
    }
  }

  function dispatch(action: Action<any> | AsyncAction<any>): any {

    // If action is of type Action<any>, return Observable of action
    if (typeof action === 'object' && (action as any)?.type) {
      store.actionStream.next(of(action));
    } else if (typeof action === 'function') {
      store.actionStream.next(action);
    } else {
      throw new Error(`Expected the action to be an object with a 'type' property or a function. Instead, received: '${kindOf(action)}'`);
    }
  }

  function replaceReducer(nextReducer: Reducer): void {
    if (typeof nextReducer !== "function") {
      throw new Error(`Expected the nextReducer to be a function. Instead, received: '${kindOf(nextReducer)}`);
    }
    store.pipeline.reducer = nextReducer;
    dispatch({
      type: actionTypes_default.REPLACE
    });
  }

  function pipe(...operators: Array<UnaryFunction<Observable<any>, Observable<any>>>): Observable<any> {
    return operators.reduce((source, operator) => operator(source), toObservable<any>(store.currentState));
  }

  return {
    ...store,
    dispatch,
    getState,
    replaceReducer,
    pipe,
    subscribe,
    subscription
  }
}

function loadModule(store: Store, module: FeatureModule): Store {
  // Check if the module already exists in the store's modules
  if (store.modules.some(m => m.slice === module.slice)) {
    // If the module already exists, return the store without changes
    return store;
  }

  // Create a new array with the module added to the store's modules
  const newModules = [...store.modules, module];

  // Setup the reducers
  const newReducer = setupReducer(store);

  // Register the module's effects
  const newEffects = [...store.pipeline.effects, ...module.effects];

  // Return a new store with the updated properties
  return {...store, modules: newModules, pipeline: {...store.pipeline, reducer: newReducer, effects: newEffects}}

}

function unloadModule(store: Store, module: FeatureModule): Store {
  // Create a new array with the module removed from the store's modules
  const newModules = store.modules.filter(m => m.slice !== module.slice);

  // Setup the reducers
  const newReducer = setupReducer(store);

  // Unregister the module's effects
  const newEffects = unregisterEffects(store, module);

  // Return a new store with the updated properties
  return {...store, modules: newModules, pipeline: {...store.pipeline, reducer: newReducer, effects: newEffects}}
}

function assertReducerShape(reducers: any): void {
  const reducerKeys = Object.keys(reducers);

  for (const key of reducerKeys) {
    const reducer = reducers[key];
    const initialState = reducer(undefined, {
      type: actionTypes_default.INIT
    });

    if (typeof initialState === "undefined") {
      throw new Error(`The slice reducer for key "${key}" returned undefined during initialization. If the state passed to the reducer is undefined, you must explicitly return the initial state. The initial state may not be undefined. If you don't want to set a value for this reducer, you can use null instead of undefined.`);
    }

    if (typeof reducer(undefined, {
      type: actionTypes_default.PROBE_UNKNOWN_ACTION()
    }) === "undefined") {
      throw new Error(`The slice reducer for key "${key}" returned undefined when probed with a random type. Don't try to handle '${actionTypes_default.INIT}' or other actions in "redux/*" namespace. They are considered private. Instead, you must return the current state for any unknown actions, unless it is undefined, in which case you must return the initial state, regardless of the action type. The initial state may not be undefined, but can be null.`);
    }
  }
}

function setupReducer(store: Store) {
  const reducers: Record<string, Reducer> = {};

  // Iterate over each module
  for (const moduleName in store.modules) {
    const module = store.modules[moduleName];

    // Combine the module's reducers
    if (module.reducer) {
      reducers[moduleName] = module.reducer;
    }
  }

  // Combine all reducers into a single reducing function
  return combineReducers(reducers);
}

function combineReducers(reducers: Record<string, Reducer>): Reducer {
  const reducerKeys = Object.keys(reducers);
  const finalReducers: any = {};

  for (const key of reducerKeys) {
    if (typeof reducers[key] === "function") {
      finalReducers[key] = reducers[key];
    }
  }

  const finalReducerKeys = Object.keys(finalReducers);

  return function combination(state = {} as any, action: any): any {
    assertReducerShape(finalReducers);

    const nextState: any = {};
    let hasChanged = false;

    for (const key of finalReducerKeys) {
      const reducer = finalReducers[key];
      const previousStateForKey = state[key];
      const nextStateForKey = reducer(previousStateForKey, action);

      if (typeof nextStateForKey === "undefined") {
        const actionType = action && action.type;
        throw new Error(`When called with an action of type ${actionType ? `"${String(actionType)}"` : "(unknown type)"}, the slice reducer for key "${key}" returned undefined. To ignore an action, you must explicitly return the previous state. If you want this reducer to hold no value, you can return null instead of undefined.`);
      }

      nextState[key] = nextStateForKey;
      hasChanged = hasChanged || nextStateForKey !== previousStateForKey;

      if (hasChanged) {
        break;
      }
    }

    if (!hasChanged && finalReducerKeys.length === Object.keys(state).length) {
      return state;
    }

    return nextState;
  };
}

function compose(...funcs: Function[]): Function {
  if (funcs.length === 0) {
    return (arg: any): any => arg;
  }

  if (funcs.length === 1) {
    return funcs[0];
  }

  return funcs.reduce((a, b) => (...args: any[]) => a(b(...args)));
}

export interface Middleware {
  (store: any): (next: (action: any) => any) => Promise<(action: any) => any> | any;
}

export type MiddlewareOperator = (store: Store) => (next: Function) => (action: any) => any;

// applyMiddleware function that accepts operator functions
// function applyMiddleware(...operators: MiddlewareOperator[]) {
//   return (createStore: Function) => (reducer: Reducer, preloadedState?: any) => {
//     const store = createStore(reducer, preloadedState);

//     // Create a pipeline function that takes dispatch and getState
//     const middlewares = (source: Observable<any>) => {
//       return operators.reduce((result, fn) => {
//         return fn(result)(store);
//       }, source);
//     };

//     return {
//       ...store,
//       middlewares
//     };
//   };
// }

function setupTransformers(store: Store) {
  return (action: Action<any> | AsyncAction<any>) => {
    const chain = store.mainModule.transformers.reduceRight((next, transformer) => {
      return (action: Action<any> | AsyncAction<any>) => transformer(store)(next)(action);
    }, (action: Action<any> | AsyncAction<any>) => action);
    let result = chain(action);
    // Ensure the result is an Observable
    return isObservable(result) ? result : of(result);
  };
}

function setupProcessors(store: Store) {
  return (action: Action<any>) => {
    const chain = store.mainModule.processors.reduceRight((next, processor) => {
      return (action: Action<any>) => {
        const result = processor(store)(next)(action);
        return isObservable(result) ? result : of(result);
      };
    }, (action: Action<any>) => of(action)); // Wrap the action in an Observable
    let result = chain(action);
    return result;
  };
}




function registerEffects(store: Store) {
  // Iterate over each module and add its effects to the pipeline
  let effects = store.mainModule.effects ? [...store.mainModule.effects] : [];
  for (const module of store.modules) {
    effects.push(...module.effects);
  }

  return effects;
}

function unregisterEffects(store: Store, module: FeatureModule): SideEffect[] {
  // Create a new array excluding the effects of the module to be unloaded
  const remainingEffects = store.pipeline.effects.filter(effect => !module.effects.includes(effect));

  // Return the array of remaining effects
  return remainingEffects;
}




export {
  actionTypes_default as __DO_NOT_USE__ActionTypes,
  //applyMiddleware,
  combineReducers, compose, createStore, isAction, isPlainObject, kindOf, loadModule, registerEffects, setupProcessors, setupReducer as setupReducers, setupTransformers, unloadModule, unregisterEffects
};

