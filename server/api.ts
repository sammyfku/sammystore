import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import multer from "multer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_PROD = process.env.NODE_ENV === "production";

const app = express();
app.use(cors());
// Preserve raw body buffer for webhook signature verification while still parsing JSON for routes
app.use(express.json({
  verify: (req: any, _res, buf: Buffer) => {
    (req as any).rawBody = buf;
  },
}));

// ─── File upload (multer) ──────────────────────────────────────────────────
const uploadsDir = path.resolve(__dirname, "../public/uploads");
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = file.originalname.split(".").pop()?.toLowerCase() ?? "jpg";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

// ─── Config ──────────────────────────────────────────────────────────��[...]
// Prefer VITE_SUPABASE_URL (the active project) over the legacy SUPABASE_URL
const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const PAYSTACK_SECRET_KEY  = process.env.PAYSTACK_SECRET_KEY ?? "";
const NOWPAYMENTS_API_KEY  = process.env.NOWPAYMENTS_API_KEY ?? "";
const ADMIN_EMAIL          = process.env.ADMIN_EMAIL ?? "";

// ─── Supabase admin client ─────────────────────────────────────────────────
let supabaseAdmin: SupabaseClient | null = null;

if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  try {
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    console.log("[API] Supabase admin client initialized");
  } catch (e) {
    console.error("[API] Failed to initialize Supabase client:", e);
  }
} else {
  console.warn("[API] ⚠️  SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY not set — auth-dependent routes will return 503");
}

// ─── Admin auto-seeding ────────────────────────────────────────────────────
async function seedAdmin() {
  if (!supabaseAdmin || !ADMIN_EMAIL) return;
  try {
    // Find the user by email
    const { data: users, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
    if (listErr || !users) return;
    const adminUser = users.users.find((u) => u.email === ADMIN_EMAIL);
    if (!adminUser) {
      console.log(`[API] Admin seed: user ${ADMIN_EMAIL} not found in auth — they must sign up first`);
      return;
    }
    // Check if role already exists
    const { data: existing } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", adminUser.id)
      .eq("role", "admin")
      .limit(1);
    if (existing && existing.length > 0) {
      console.log(`[API] Admin seed: ${ADMIN_EMAIL} already has admin role ✓`);
      return;
    }
    // Insert admin role
    const { error: insertErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: adminUser.id, role: "admin" });
    if (insertErr) {
      console.error("[API] Admin seed: failed to insert role —", insertErr.message);
    } else {
      console.log(`[API] ✅ Admin role granted to ${ADMIN_EMAIL}`);
    }
  } catch (e) {
    console.error("[API] Admin seed error:", e);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────�[...]
function requireSupabase(res: express.Response): supabaseAdmin is SupabaseClient {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Service temporarily unavailable — Supabase not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Replit Secrets." });
    return false;
  }
  return true;
}

async function getAuthUser(req: express.Request) {
  if (!supabaseAdmin) return null;
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

function err(res: express.Response, status: number, msg: string) {
  return res.status(status).json({ error: msg });
}

// ─── Routes ──────────────────────────────────────────────────────────�[...]

// Image upload — no auth required (admin-only UI enforces access control)
app.post("/api/upload/image", upload.single("file"), (req, res) => {
  if (!req.file) return err(res, 400, "No file uploaded");
  const siteUrl =
    process.env.VITE_SITE_URL ??
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "");
  const url = siteUrl
    ? `${siteUrl}/uploads/${req.file.filename}`
    : `/uploads/${req.file.filename}`;
  return res.json({ url });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    supabase: !!supabaseAdmin,
    paystack: !!PAYSTACK_SECRET_KEY,
    nowpayments: !!NOWPAYMENTS_API_KEY,
    adminEmail: ADMIN_EMAIL || null,
  });
});

app.post("/api/payment/verify-paystack", async (req, res) => {
  if (!requireSupabase(res)) return;
  const user = await getAuthUser(req);
  if (!user) return err(res, 401, "Unauthorized");

  const { reference, userId } = req.body as { reference?: string; userId?: string };
  if (!reference || !userId) return err(res, 400, "reference and userId are required");
  if (userId !== user.id) return err(res, 403, "Forbidden");

  const { data: intent, error: intentErr } = await supabaseAdmin!
    .from("payment_intents")
    .select("*")
    .eq("reference", reference)
    .eq("user_id", userId)
    .eq("provider", "paystack")
    .single();

  if (intentErr || !intent) return err(res, 400, "Invalid or expired payment reference");
  if ((intent as Record<string, unknown>).status === "success") {
    return res.json({ success: true, amount: Number((intent as Record<string, unknown>).amount), alreadyCredited: true });
  }

  if (!PAYSTACK_SECRET_KEY) return err(res, 500, "Paystack is not configured — contact support");

  let paystackRes: Response;
  try {
    paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
    );
  } catch {
    return err(res, 502, "Could not reach Paystack — please try again later");
  }

  if (!paystackRes.ok) return err(res, 502, "Could not verify with Paystack — please try again");

  const json = (await paystackRes.json()) as { status: boolean; data?: { status: string; amount: number } };
  if (!json.status || json.data?.status !== "success") {
    return err(res, 400, "Payment not confirmed — contact support if you were charged");
  }

  const amount = (json.data?.amount ?? 0) / 100;

  const { error: creditErr } = await supabaseAdmin!.rpc(
    "credit_wallet" as never,
    { _user_id: userId, _amount: amount, _provider: "paystack", _reference: reference, _description: "Wallet funded via Paystack" } as never
  );
  if (creditErr) return err(res, 500, (creditErr as { message: string }).message);

  await supabaseAdmin!
    .from("payment_intents")
    .update({ status: "success", updated_at: new Date().toISOString() })
    .eq("reference", reference);

  return res.json({ success: true, amount, alreadyCredited: false });
});

app.post("/api/payment/nowpayments-invoice", async (req, res) => {
  if (!requireSupabase(res)) return;
  const user = await getAuthUser(req);
  if (!user) return err(res, 401, "Unauthorized");

  const { amount, userId, reference } = req.body as { amount?: number; userId?: string; reference?: string };
  if (!amount || !userId || !reference) return err(res, 400, "amount, userId and reference are required");
  if (userId !== user.id) return err(res, 403, "Forbidden");

  const { data: intent, error: intentErr } = await supabaseAdmin!
    .from("payment_intents")
    .select("id")
    .eq("reference", reference)
    .eq("user_id", userId)
    .eq("provider", "nowpayments")
    .single();

  if (intentErr || !intent) return err(res, 400, "Invalid payment reference");
  if (!NOWPAYMENTS_API_KEY) return err(res, 500, "NOWPayments is not configured — contact support");

  const siteUrl =
    process.env.VITE_SITE_URL ??
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "https://mmystorelogs.com");

  let nowRes: Response;
  try {
    nowRes = await fetch("https://api.nowpayments.io/v1/invoice", {
      method: "POST",
      headers: { "x-api-key": NOWPAYMENTS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        price_amount: amount,
        price_currency: "ngn",
        order_id: reference,
        order_description: "Sammy Store Logs — Wallet Funding",
        success_url: `${siteUrl}/wallet?funded=crypto`,
        cancel_url: `${siteUrl}/wallet`,
      }),
    });
  } catch {
    return err(res, 502, "Could not reach NOWPayments — please try again later");
  }

  if (!nowRes.ok) {
    const errText = await nowRes.text();
    return err(res, 502, `NOWPayments error: ${errText}`);
  }
  const invoice = (await nowRes.json()) as { invoice_url: string; id: string };
  return res.json({ invoiceUrl: invoice.invoice_url, invoiceId: invoice.id });
});

app.post("/api/payment/nowpayments-status", async (req, res) => {
  if (!requireSupabase(res)) return;
  const user = await getAuthUser(req);
  if (!user) return err(res, 401, "Unauthorized");

  const { reference, userId } = req.body as { reference?: string; userId?: string };
  if (!reference || !userId) return err(res, 400, "reference and userId are required");
  if (userId !== user.id) return err(res, 403, "Forbidden");

  const { data: intent } = await supabaseAdmin!
    .from("payment_intents")
    .select("*")
    .eq("reference", reference)
    .eq("user_id", userId)
    .single();

  if (!intent) return err(res, 404, "Payment intent not found");
  if ((intent as Record<string, unknown>).status === "success") return res.json({ status: "success", alreadyCredited: true });

  if (!NOWPAYMENTS_API_KEY) return err(res, 500, "NOWPayments not configured");

  let nowRes: Response;
  try {
    nowRes = await fetch(
      `https://api.nowpayments.io/v1/payment?order_id=${encodeURIComponent(reference)}&limit=1`,
      { headers: { "x-api-key": NOWPAYMENTS_API_KEY } }
    );
  } catch {
    return err(res, 502, "Failed to check payment status — please try again");
  }

  if (!nowRes.ok) return err(res, 502, "Failed to check payment status");

  const json = (await nowRes.json()) as { data?: { payment_status?: string }[] };
  const paymentStatus = json.data?.[0]?.payment_status ?? "waiting";

  if (paymentStatus === "finished" || paymentStatus === "confirmed") {
    const { error: creditErr } = await supabaseAdmin!.rpc(
      "credit_wallet" as never,
      { _user_id: userId, _amount: Number((intent as Record<string, unknown>).amount), _provider: "nowpayments", _reference: reference, _description: "Wallet funded via NOWPayments (crypto)" } as never
    );
    if (!creditErr) {
      await supabaseAdmin!
        .from("payment_intents")
        .update({ status: "success", updated_at: new Date().toISOString() })
        .eq("reference", reference);
      return res.json({ status: "success", alreadyCredited: false });
    }
  }
  return res.json({ status: paymentStatus, alreadyCredited: false });
});

app.post("/api/payment/admin-credit", async (req, res) => {
  if (!requireSupabase(res)) return;
  const user = await getAuthUser(req);
  if (!user) return err(res, 401, "Unauthorized");

  const { data: roles } = await supabaseAdmin!
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .limit(1);
  if (!roles?.length) return err(res, 403, "Forbidden: admin access required");

  const { targetUserId, amount, description } = req.body as { targetUserId?: string; amount?: number; description?: string };
  if (!targetUserId || !amount || !description) return err(res, 400, "targetUserId, amount and description are required");

  const ref = `admin-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

  const { error: creditErr } = await supabaseAdmin!.rpc(
    "credit_wallet" as never,
    { _user_id: targetUserId, _amount: amount, _provider: "manual", _reference: ref, _description: description } as never
  );
  if (creditErr) return err(res, 500, (creditErr as { message: string }).message);

  await supabaseAdmin!.from("activity_logs").insert({
    actor_id: user.id,
    action: "admin_credit_wallet",
    target: targetUserId,
    metadata: { amount, description, ref },
  });

  return res.json({ success: true });
});

app.post("/api/delivery/assign-credential", async (req, res) => {
  if (!requireSupabase(res)) return;
  const user = await getAuthUser(req);
  if (!user) return err(res, 401, "Unauthorized");

  const { orderId, productId } = req.body as { orderId?: string; productId?: string };
  if (!orderId || !productId) return err(res, 400, "orderId and productId are required");

  const { data: order } = await supabaseAdmin!
    .from("orders").select("id, user_id, status").eq("id", orderId).single();
  if (!order) return err(res, 404, "Order not found");
  if ((order as Record<string, unknown>).user_id !== user.id) return err(res, 403, "Forbidden");

  // Step 1: Already delivered? Return stored content directly (no credential lookup needed).
  const { data: existingItem } = await supabaseAdmin!
    .from("order_items").select("delivered_payload")
    .eq("order_id", orderId).eq("product_id", productId).limit(1).single();
  if (existingItem?.delivered_payload) {
    return res.json({ assigned: true, content: existingItem.delivered_payload, label: null });
  }

  // Step 2: purchase_with_wallet calls assign_credential_to_order which sets order_id on the
  // credential but does NOT update order_items.delivered_payload. Find that credential here.
  const { data: assignedCred } = await supabaseAdmin!
    .from("product_credentials").select("id, content, label")
    .eq("order_id", orderId).eq("product_id", productId).limit(1).single();

  let credId: string | null = null;
  let credContent: string | null = null;

