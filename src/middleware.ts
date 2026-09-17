import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { clientEnv } from '@/env/client';

/**
 * Refreshes the auth cookie on every request. Server Components cannot write
 * cookies, so without this a session silently expires mid-shift and the next
 * mutation fails instead of the page redirecting to login.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet: { name: string; value: string; options: CookieOptions }[]) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Revalidates the token rather than trusting the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  /**
   * Route handlers answer for themselves. Redirecting /api/* to the login
   * PAGE hands a JSON client a lump of HTML, so a session that expires
   * mid-shift would surface as a parse error rather than a 401 — exactly the
   * 3am confusion this app exists to avoid. The handlers call requireUser()
   * and return a typed 401.
   */
  if (pathname.startsWith('/api/')) return response;

  if (!user && pathname !== '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|ico)$).*)'],
};
