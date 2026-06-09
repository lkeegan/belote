import { DurableObject } from "cloudflare:workers";

/**
 * Welcome to Cloudflare Workers! This is your first Durable Objects application.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Durable Object in action
 * - Run `npm run deploy` to publish your application
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/durable-objects
 */

/** A Durable Object's behavior is defined in an exported Javascript class */
export class MyDurableObject extends DurableObject<Env> {
	/**
	 * The constructor is invoked once upon creation of the Durable Object, i.e. the first call to
	 * 	`DurableObjectStub::get` for a given identifier (no-op constructors can be omitted)
	 *
	 * @param ctx - The interface for interacting with Durable Object state
	 * @param env - The interface to reference bindings declared in wrangler.jsonc
	 */
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	/**
	 * The Durable Object exposes an RPC method sayHello which will be invoked when a Durable
	 *  Object instance receives a request from a Worker via the same method invocation on the stub
	 *
	 * @param name - The name provided to a Durable Object instance from a Worker
	 * @returns The greeting to be sent back to the Worker
	 */
	async sayHello(name: string): Promise<string> {
		return `Hello, ${name}!`;
	}
}

// The deployed frontend; always allowed to read the worker's responses. The
// site is served from www.keegan.ch; the apex is included in case it is used.
const PROD_ORIGINS = new Set([
	"https://www.keegan.ch",
	"https://keegan.ch",
]);

// The local Vite dev and preview servers; only allowed when the worker itself
// is running locally (under `wrangler dev`), never in production.
const DEV_ORIGINS = new Set(["http://localhost:5173", "http://localhost:4173"]);

/**
 * CORS headers for a request: reflect the Origin back only when it is allowed,
 * so other sites' browser JS cannot read the response. localhost origins are
 * accepted only in local development, signalled by ENVIRONMENT=development
 * (set in .dev.vars, which `wrangler dev` loads; the deployed worker uses the
 * "production" value from wrangler.jsonc).
 */
function corsHeaders(request: Request, env: Env): Record<string, string> {
	const isDev = env.ENVIRONMENT === "development";
	const allowed = isDev
		? new Set([...PROD_ORIGINS, ...DEV_ORIGINS])
		: PROD_ORIGINS;
	const origin = request.headers.get("Origin");
	if (origin && allowed.has(origin)) {
		return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
	}
	return { Vary: "Origin" };
}

export default {
	/**
	 * This is the standard fetch handler for a Cloudflare Worker
	 *
	 * @param request - The request submitted to the Worker from the client
	 * @param env - The interface to reference bindings declared in wrangler.jsonc
	 * @param ctx - The execution context of the Worker
	 * @returns The response to be sent back to the client
	 */
	async fetch(request, env, ctx): Promise<Response> {
		// Create a stub to open a communication channel with the Durable Object
		// instance named "foo".
		//
		// Requests from all Workers to the Durable Object instance named "foo"
		// will go to a single remote Durable Object instance.
		const stub = env.MY_DURABLE_OBJECT.getByName("foo");

		// Call the `sayHello()` RPC method on the stub to invoke the method on
		// the remote Durable Object instance.
		const greeting = await stub.sayHello("belote worker");

		// Allow only the known frontend origins to read the response in a browser.
		return new Response(greeting, { headers: corsHeaders(request, env) });
	},
} satisfies ExportedHandler<Env>;
