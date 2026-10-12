// Las funciones de Prodi Software vinieron de MP Socios (Next.js). Esto les da lo poco que usaban de Next
// (NextRequest / NextResponse) sobre las funciones de Vercel de Prodi, así el código queda casi igual.
// Quién puede llamar a cada una lo decide api/software/[accion].ts ANTES de correrla (con el usuario de Prodi).

export class NextRequest {
  readonly url: string;
  readonly nextUrl: URL;
  readonly method: string;
  readonly headers: Headers;
  private readonly cuerpo: string;

  constructor(url: string, method: string, headers: Headers, cuerpo: string) {
    this.url = url;
    this.nextUrl = new URL(url);
    this.method = method;
    this.headers = headers;
    this.cuerpo = cuerpo;
  }

  async text(): Promise<string> {
    return this.cuerpo;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- igual que en Next (el código de MP Socios lo usa así)
  async json(): Promise<any> {
    return JSON.parse(this.cuerpo || "null");
  }
}

export class NextResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: string;

  constructor(body?: string | null, init?: { status?: number; headers?: Record<string, string> | Headers }) {
    this.status = init?.status ?? 200;
    this.headers = new Headers(init?.headers as ConstructorParameters<typeof Headers>[0]);
    this.body = body ?? "";
  }

  static json(data: unknown, init?: { status?: number; headers?: Record<string, string> }): NextResponse {
    const r = new NextResponse(JSON.stringify(data), init);
    r.headers.set("Content-Type", "application/json; charset=utf-8");
    return r;
  }
}

/** El acceso ya lo controló el despachador con el usuario de Prodi: acá siempre hay sesión. */
export async function requireSession(): Promise<{ email: string }> {
  return { email: "prodi" };
}
export async function requireSessionFromRequest(): Promise<{ email: string }> {
  return { email: "prodi" };
}
export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "No autorizado" }, { status: 401 });
}
