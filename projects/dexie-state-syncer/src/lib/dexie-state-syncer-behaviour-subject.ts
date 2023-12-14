import { Subscription, Observable } from 'rxjs';


export function toObservable<T>(customAsyncSubject: CustomAsyncSubject<T>): Observable<T> {
  return new Observable<T>((subscriber) => {
    customAsyncSubject.subscribe({
      next: async (value) => {
        subscriber.next(value);
      },
      error: async (error) => {
        subscriber.error(error);
      },
      complete: async () => {
        subscriber.complete();
      }
    }).then((subscription) => {
      return () => subscription.unsubscribe();
    });
  });
}

export type AsyncObserver<T> = {
  next: (value: T) => Promise<void>;
  error?: (error: any) => Promise<void>;
  complete?: () => Promise<void>;
};

export class AsyncObservable<T> {
  private observers: AsyncObserver<T>[] = [];

  constructor() {}

  async subscribe(observer: AsyncObserver<T>): Promise<Subscription> {
    this.observers.push(observer);
    return {
      unsubscribe: () => {
        const index = this.observers.indexOf(observer);
        if (index >= 0) {
          this.observers.splice(index, 1);
        }
      }
    } as Subscription;
  }

  async notify(value: T): Promise<void> {
    await Promise.all(this.observers.map(observer => observer.next(value)));
  }

  async notifyError(error: any): Promise<void> {
    await Promise.all(this.observers.map(observer => observer.error && observer.error(error)));
  }

  async notifyComplete(): Promise<void> {
    await Promise.all(this.observers.map(observer => observer.complete && observer.complete()));
  }
}

export class CustomAsyncSubject<T> extends AsyncObservable<T> {
  private _value!: T;

  constructor() {
    super();
  }

  override async subscribe(observer: Partial<AsyncObserver<T>>): Promise<Subscription> {
    // Emit the current value to the observer as soon as it subscribes
    if (observer.next) {
      await observer.next(this._value);
    }
    // Convert the unsubscribe function to a Subscription object
    return await super.subscribe(observer as AsyncObserver<T>);
  }

  async next(value: T): Promise<void> {
    this._value = value;
    await this.notify(value);
  }

  get value(): T {
    return this._value;
  }
}
