import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { createLogger, createNestMiddleware, isValidLevel, type LogLevel } from "cenglu";
import { AppService } from "./app.service";
import { HealthModule } from "./health/health.module";
import { LoggerModule } from "./logger/logger.module";
import { UsersModule } from "./users/user.module";

const envLevel = process.env.LOG_LEVEL;
const level: LogLevel = isValidLevel(envLevel) ? envLevel : "debug";

const logger = createLogger({
  service: "nestjs-example",
  level,
  pretty: { enabled: process.env.NODE_ENV !== "production" },
});

const LoggerMiddleware = createNestMiddleware(logger, {
  excludePaths: ["/health", "/ready", "/metrics"],
  includeQuery: true,
  includeParams: true,
});

@Module({
  imports: [
    LoggerModule.forRoot({
      logger,
      isGlobal: true,
    }),
    UsersModule,
    HealthModule,
  ],
  controllers: [],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply logging middleware to all routes
    consumer.apply(LoggerMiddleware).forRoutes("*");
  }
}
