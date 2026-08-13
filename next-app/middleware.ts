import { clerkMiddleware } from "@clerk/nextjs/server";

// Enables Clerk auth context across the app. Route protection is handled at the
// page level (SignedIn / SignedOut) so nothing hard-redirects before Clerk's
// satellite config is live.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next internals and static files.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|ico|webp|woff2?|ttf)).*)",
    "/(api|trpc)(.*)",
  ],
};
