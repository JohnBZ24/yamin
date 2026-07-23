import {
  HttpStatus,
  UnprocessableEntityException,
  ValidationError,
  ValidationPipeOptions,
} from '@nestjs/common';

function generateErrors(errors: ValidationError[]) {
  return errors.reduce(
    (accumulator, currentValue) => ({
      ...accumulator,
      [currentValue.property]:
        (currentValue.children?.length ?? 0) > 0
          ? generateErrors(currentValue.children ?? [])
          : Object.values(currentValue.constraints ?? {}).join(', '),
    }),
    {},
  );
}

const validationOptions: ValidationPipeOptions = {
  transform: true, //auto convert types
  whitelist: true, //strip extra fieds not in dto
  errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
  exceptionFactory: (errors: ValidationError[]) => {
    return new UnprocessableEntityException({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      errors: generateErrors(errors),
    });
  },
};

export default validationOptions;
//[1, 2, 3].reduce((accumulator, currentValue) => {
//return accumulator + currentValue;
//}, 0);
// 0 is the starting value

// Step 1: accumulator=0,  currentValue=1  → 0+1  = 1
// Step 2: accumulator=1,  currentValue=2  → 1+2  = 3
// Step 3: accumulator=3,  currentValue=3  → 3+3  = 6
// Final result: 6
