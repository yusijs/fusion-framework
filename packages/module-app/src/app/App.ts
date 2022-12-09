import { AppConfig, AppManifest, AppModulesInstance, AppScriptModule } from '../types';
import { FlowSubject, Observable } from '@equinor/fusion-observable';

import type { AppModuleProvider } from '../AppModuleProvider';
import {
    combineLatest,
    filter,
    firstValueFrom,
    lastValueFrom,
    map,
    of,
    OperatorFunction,
    Subscription,
} from 'rxjs';
import { EventModule } from '@equinor/fusion-framework-module-event';
import { AnyModule, ModuleType } from '@equinor/fusion-framework-module';
import { createState } from './create-state';
import { actions, Actions } from './actions';
import { AppBundleState } from './types';

import '../events';

// TODO - move globally
export function filterEmpty<T>(): OperatorFunction<T | null | undefined, T> {
    return filter((value): value is T => value !== undefined && value !== null);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class App<TEnv = any, TModules extends Array<AnyModule> | unknown = unknown> {
    #state: FlowSubject<AppBundleState, Actions>;

    //#region === streams ===

    get manifest$(): Observable<AppManifest> {
        return this.#state.pipe(
            map(({ manifest }) => manifest),
            filterEmpty()
        );
    }

    get config$(): Observable<AppConfig<TEnv>> {
        return this.#state.pipe(
            map(({ config }) => config),
            filterEmpty()
        );
    }

    get modules$(): Observable<AppScriptModule> {
        return this.#state.pipe(
            map(({ modules }) => modules),
            filterEmpty()
        );
    }

    get instance$(): Observable<AppModulesInstance<TModules>> {
        return this.#state.pipe(
            map(({ instance }) => instance as AppModulesInstance<TModules>),
            filterEmpty()
        );
    }

    //#endregion

    get appKey(): string {
        return this.#state.value.appKey;
    }

    get manifest(): Promise<AppManifest> {
        return firstValueFrom(this.manifest$);
    }

    get config(): Promise<AppConfig<TEnv>> {
        return firstValueFrom(this.config$);
    }

    get instance(): AppModulesInstance<TModules> | undefined {
        return this.#state.value.instance as AppModulesInstance<TModules>;
    }

    constructor(
        appKey: string,
        args: { provider: AppModuleProvider; event?: ModuleType<EventModule> }
    ) {
        this.#state = createState(appKey, args.provider);

        const subscriptions = new Subscription();

        if (args.event) {
            subscriptions.add(
                args.event.addEventListener('onAppModulesLoaded', (e) => {
                    if (e.detail.appKey === appKey) {
                        this.#state.next(actions.setInstance(e.detail.modules));
                    }
                })
            );
        }

        this.dispose = () => {
            if (this.#state.value.instance) {
                this.#state.value.instance.dispose();
            }
            subscriptions.unsubscribe();
            this.#state.complete();
        };
    }

    public initialize(): Observable<[AppManifest, AppScriptModule, AppConfig]> {
        return combineLatest([this.getManifest(), this.getAppModule(), this.getConfig()]);
    }

    public loadConfig() {
        this.#state.next(actions.fetchConfig(this.appKey));
    }

    public loadManifest() {
        this.#state.next(actions.fetchManifest(this.appKey));
    }

    public async loadAppModule(allow_cache = true) {
        const manifest = await this.getManifestAsync(allow_cache);
        this.#state.next(actions.importApp(manifest.entry));
    }

    public getConfig(force_refresh = false): Observable<AppConfig> {
        return new Observable((subscriber) => {
            if (this.#state.value.config) {
                subscriber.next(this.#state.value.config);
                if (!force_refresh) {
                    return subscriber.complete();
                }
            }
            subscriber.add(
                this.#state.addEffect('set_config', ({ payload }) => {
                    subscriber.next(payload);
                })
            );
            subscriber.add(
                this.#state.addEffect('fetch_config::success', ({ payload }) => {
                    subscriber.next(payload);
                    subscriber.complete();
                })
            );
            subscriber.add(
                this.#state.addEffect('fetch_config::failure', ({ payload }) => {
                    subscriber.error(
                        Error('failed to load application config', {
                            cause: payload,
                        })
                    );
                })
            );

            this.loadConfig();
        });
    }

    public getConfigAsync(allow_cache = true): Promise<AppConfig> {
        const operator = allow_cache ? firstValueFrom : lastValueFrom;
        return operator(this.getConfig(!allow_cache));
    }

    public getManifest(force_refresh = false): Observable<AppManifest> {
        return new Observable((subscriber) => {
            if (this.#state.value.manifest) {
                subscriber.next(this.#state.value.manifest);
                if (!force_refresh) {
                    return subscriber.complete();
                }
            }
            subscriber.add(
                this.#state.addEffect('set_manifest', ({ payload }) => {
                    subscriber.next(payload);
                })
            );
            subscriber.add(
                this.#state.addEffect('fetch_manifest::success', ({ payload }) => {
                    subscriber.next(payload);
                    subscriber.complete();
                })
            );
            subscriber.add(
                this.#state.addEffect('fetch_manifest::failure', ({ payload }) => {
                    subscriber.error(
                        Error('failed to load application manifest', {
                            cause: payload,
                        })
                    );
                })
            );

            this.loadManifest();
        });
    }

    public getManifestAsync(allow_cache = true): Promise<AppManifest> {
        const operator = allow_cache ? firstValueFrom : lastValueFrom;
        return operator(this.getManifest(!allow_cache));
    }

    public getAppModule(force_refresh = false): Observable<AppScriptModule> {
        return new Observable((subscriber) => {
            if (this.#state.value.modules) {
                subscriber.next(this.#state.value.modules);
                if (!force_refresh) {
                    return subscriber.complete();
                }
            }
            subscriber.add(
                this.#state.addEffect('set_module', ({ payload }) => {
                    subscriber.next(payload);
                })
            );
            subscriber.add(
                this.#state.addEffect('import_app::success', ({ payload }) => {
                    subscriber.next(payload);
                    subscriber.complete();
                })
            );
            subscriber.add(
                this.#state.addEffect('import_app::failure', ({ payload }) => {
                    subscriber.error(
                        Error('failed to load application modules from script', {
                            cause: payload,
                        })
                    );
                })
            );

            subscriber.add(
                this.getManifest().subscribe((manifest) =>
                    of(this.#state.next(actions.importApp(manifest.entry)))
                )
            );
        });
    }

    public getAppModuleAsync(allow_cache = true): Promise<AppScriptModule> {
        const operator = allow_cache ? firstValueFrom : lastValueFrom;
        return operator(this.getAppModule(!allow_cache));
    }

    public dispose: VoidFunction;
}
