import { createApp } from '../server/http/app.js';

const app = createApp();

export const GET = (request: Request) => app(request);
export const POST = (request: Request) => app(request);
export const DELETE = (request: Request) => app(request);
