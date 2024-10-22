import { kv } from '@vercel/kv';
import { Hono } from 'hono';
import { env } from 'hono/adapter';
import { html } from 'hono/html';
import { ENV_VAR, STATUS_CODE } from '../utils/constants';
import sendResponse from '../utils/response';
const oauthRouter = new Hono();
const AUTH_MAP = new Map();

const INITIAL_VALUE = 'temp_value';

oauthRouter.get('/clickup', async (c) => {
  const { CLIENT_ID, REDIRECT_URL } = env(c);
  const id = c.req.query('id');

  if (!id) {
    return sendResponse(c, 'error', 'No provided ID');
  }

  await kv.set(`init-${id}`, true);

  const clickupAuthUrl = `https://app.clickup.com/api?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URL}?id=${id}`;
  return c.redirect(clickupAuthUrl);
});

oauthRouter.get('/callback', async (c) => {
  const code = c.req.query('code');
  const id = c.req.query('id');

  if (!code || !id) {
    return sendResponse(c, 'error', 'No code was provided');
  }

  const isValidId = await kv.get(`init-${id}`);
  if (!isValidId) {
    return sendResponse(c, 'error', 'Invalid request ID');
  }

  const { CLIENT_ID, CLIENT_SECRET } = env<ENV_VAR>(c);

  const tokenUrl = `https://api.clickup.com/api/v2/oauth/token`;
  const body = {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code: code,
  };

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorResponse = await response.json();
      return sendResponse(
        c,
        'error',
        errorResponse.message || 'Failed to retrieve access token',
        undefined,
        STATUS_CODE.UNAUTHORIZED
      );
    }

    const data = await response.json();

    await kv.hset(id, { access_token: data.access_token });

    return c.html(
      html`<!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <meta
              name="viewport"
              content="width=device-width, initial-scale=1.0"
            />
            <title>Authorization Successful</title>
            <link
              href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css"
              rel="stylesheet"
            />
          </head>
          <body class="flex items-center justify-center h-screen bg-gray-100">
            <div class="text-center">
              <h1 class="text-3xl font-bold text-green-600">
                Your app is authorized!
              </h1>
              <p class="mt-4 text-lg text-gray-700">
                You can close this window and return to Figma.
              </p>
            </div>
          </body>
        </html>`
    );
  } catch (error) {
    console.error('Error fetching access token:', error);
    return sendResponse(
      c,
      'error',
      'An error occurred while retrieving the access token',
      undefined,
      STATUS_CODE.UNAUTHORIZED
    );
  }
});

oauthRouter.post('/access-token', async (c) => {
  const body = await c.req.json();
  const { id } = body;
  const accessToken = await kv.hget(id, 'access_token');
  if (accessToken) {
    return sendResponse(c, 'success', 'Access token retrieved successfully', {
      access_token: accessToken,
    });
  }

  return sendResponse(c, 'error', 'No available access token');
});

export default oauthRouter;