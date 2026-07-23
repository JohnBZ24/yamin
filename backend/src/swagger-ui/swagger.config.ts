import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { DocumentBuilder } from '@nestjs/swagger';

/**
 * Get the Swagger CSS file path and content
 * Tries dist path first (production), falls back to src path (development)
 */
export function getSwaggerDarkCss(): string {
  const distPath = join(__dirname, 'SwaggerDark', 'SwaggerDark.css');
  const srcPath = join(
    process.cwd(),
    'src',
    'swagger-ui',
    'SwaggerDark',
    'SwaggerDark.css',
  );
  const cssPath = existsSync(distPath) ? distPath : srcPath;
  return readFileSync(cssPath, 'utf8');
}

/**
 * Swagger UI options configuration
 */
export const swaggerOptions = {
  persistAuthorization: true,

  // collapse operations (optional)
  docExpansion: 'list', // 'none' | 'list' | 'full'

  // make the example tree as small as possible
  defaultModelExpandDepth: 0, // collapse JSON properties
  defaultModelsExpandDepth: -1, // hide "Models" section at bottom

  // show "Schema" first instead of "Example Value"
  defaultModelRendering: 'Example Value',
  explorer: true,

  // /** Show request body details as example or model */
  displayRequestDuration: true, // show duration badges

  // /** Show the operationId on each endpoint */
  displayOperationId: true,

  // /** Sort operations within each tag */
  operationsSorter: 'alpha', // 'alpha' | 'method' | custom function

  // /** Sort tags in the sidebar */
  tagsSorter: 'alpha', // 'alpha' | custom function

  // /** Enable/disable deep-linking (#/path) */
  deepLinking: true,

  // /** Show extensions (x-*) */
  showExtensions: true,
  showCommonExtensions: true,

  // /** Filter endpoints by text */
  filter: true, // or a string for default filter value
};

/**
 * Swagger DocumentBuilder configuration
 */
export function createSwaggerDocumentBuilder() {
  return new DocumentBuilder()
    .setTitle('CBK Boilerplate')
    .setDescription('API docs')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
}
