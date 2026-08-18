import { clearSession } from "../../../lib/session";
import { requireSameOrigin } from "../../../lib/request";
export async function POST(request:Request){const invalid=requireSameOrigin(request);if(invalid)return invalid;await clearSession();return Response.json({ok:true})}
