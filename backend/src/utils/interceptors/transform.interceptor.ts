import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map } from 'rxjs/operators';
import { Observable } from 'rxjs';

interface ResponseFormat<T> {
  status: string;
  data: T;
}

@Injectable()
export class ResponseTransformInterceptor<T>
  implements NestInterceptor<T, ResponseFormat<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ResponseFormat<T>> {
    // The `next.handle()` method returns an Observable stream that represents the response data.
    // Observables are used for asynchronous handling of events or data streams in a reactive way.
    return next.handle().pipe(
      map((data) => {
        // check if data is an object and already has a data property
        if (data && typeof data === 'object' && 'data' in data) {
          // add the status'property without rewrapping
          return {
            ...data,
            status: 'success',
          };
        }

        // if not : wrap the data with status and data properties
        return {
          status: 'success',
          data,
        };
      }),
    );
  }
}
