import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { handleError } from '../error/error-handler';

// The .pipe(catchError(...)) operates on the response stream produced by the handler,
// indicating that it intercepts and processes response errors.
@Injectable()
export class ErrorHandlingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((error) => {
        // Define default errorCode and message
        // You can customize these based on the context or error type if needed
        const defaultErrorCode = 'INTERNAL_SERVER_ERROR';
        const defaultMessage =
          'An unexpected error occurred. Please try again later.';

        // Delegate the error handling to the handleError function
        handleError(error, defaultErrorCode, defaultMessage);
      }),
    );
  }
}
//The Observable wrapper does one thing — lets you react to what happens during the request:

//context gives you info about the current request
//next.handle() like the next in express
//lets you attach reactions to whatever comes out of next.handle()
//In backend development, an observable is an object representing a stream of data or events over time. is an object representing a stream of data or events over time. Instead of fetching data once and waiting (like a traditional Promise), components "subscribe" to it, allowing your server to automatically react whenever new data or an event is emitted.
//Request arrives
//    ↓
//NestJS receives it        ← NestJS handles this part
//     ↓
//NestJS calls intercept()  ← hands it to interceptor
//      ↓
//next.handle()             ← wraps it in Observable
//    ↓
//.pipe(catchError)         ← now you can react ✅
//NestJS receives request → hands it to interceptor
//next.handle() wraps it → now you react via .pipe() ✅

//Works for:
//HTTP requests    → emits once ✅
//WebSockets       → emits many times ✅
//Server sent events → keeps emitting ✅
