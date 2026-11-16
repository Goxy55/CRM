import { getAuth } from "@/server/auth";

/** Prijava, odjava, sesija i reset lozinke (Better Auth). */
const handle = (request: Request) => getAuth().handler(request);
export { handle as GET, handle as POST };
