import {
  DynamicModule,
  Global,
  InjectionToken,
  Module,
  OptionalFactoryDependency,
  Provider,
} from '@nestjs/common';
import {
  Logger,
  CENGLU_LOGGER,
  NestLoggerModuleOptions,
  NestLoggerService,
  NestLoggerModuleAsyncOptions,
  CENGLU_LOGGER_OPTIONS,
} from 'cenglu';

@Global()
@Module({})
export class LoggerModule {
  static forRoot(options: NestLoggerModuleOptions): DynamicModule {
    const loggerProvider: Provider = {
      provide: CENGLU_LOGGER,
      useValue: options.logger,
    };

    const loggerServiceProvider: Provider = {
      provide: NestLoggerService,
      useFactory: (logger: Logger) => new NestLoggerService(logger),
      inject: [CENGLU_LOGGER],
    };

    return {
      module: LoggerModule,
      global: options.isGlobal ?? true,
      providers: [
        loggerProvider,
        loggerServiceProvider,
        {
          provide: CENGLU_LOGGER_OPTIONS,
          useValue: options,
        },
      ],
      exports: [CENGLU_LOGGER, NestLoggerService],
    };
  }

  static forRootAsync(options: NestLoggerModuleAsyncOptions): DynamicModule {
    const asyncProviders = this.createAsyncProviders(options);

    return {
      module: LoggerModule,
      global: options.isGlobal ?? true,
      imports: (options.imports ?? []) as Array<
        DynamicModule | Promise<DynamicModule>
      >,
      providers: [
        ...asyncProviders,
        {
          provide: NestLoggerService,
          useFactory: (logger: Logger) => new NestLoggerService(logger),
          inject: [CENGLU_LOGGER],
        },
      ],
      exports: [CENGLU_LOGGER, NestLoggerService],
    };
  }

  private static createAsyncProviders(
    options: NestLoggerModuleAsyncOptions,
  ): Provider[] {
    return [
      {
        provide: CENGLU_LOGGER_OPTIONS,
        useFactory: options.useFactory,
        inject: (options.inject ?? []) as Array<
          InjectionToken | OptionalFactoryDependency
        >,
      },
      {
        provide: CENGLU_LOGGER,
        useFactory: (opts: NestLoggerModuleOptions) => opts.logger,
        inject: [CENGLU_LOGGER_OPTIONS],
      },
    ];
  }
}

export function InjectLogger(): ParameterDecorator {
  return (target, propertyKey) => {
    // This would integrate with NestJS's DI system
    // For now, we use the simpler approach of injecting CENGLU_LOGGER
    Reflect.defineMetadata(
      'design:paramtypes',
      [Logger],
      target,
      propertyKey as string,
    );
  };
}
