/* App 内购（只在 App 版里用）：一次买断「全部解锁」。
 * 商店付款 → 把凭据发给服务端（/api/iap/verify，服务端向 Google / Apple 核实）→ 拿到解锁凭证存本机（lib.ts 的 entToken）。
 * 插件 @capgo/native-purchases：Android 用 Google Play Billing，iOS 用 StoreKit 2。网页版不会加载这个文件里的插件。 */
import { api, ApiError, save } from './lib';

export const PRODUCT = 'kpp_unlock_all';   // 两个商店后台里建的商品 ID 都用这个（非消耗型 / 一次性商品）
type Mod = typeof import('@capgo/native-purchases');
let mod: Mod | null = null;
const np = async () => (mod ||= await import('@capgo/native-purchases'));

export const platform = (): 'ios' | 'android' | 'web' => ((window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() as 'ios' | 'android') || 'web';
export const storeName = () => (platform() === 'ios' ? 'App Store' : 'Google Play');

/** 商店里的价格（已按用户所在地区换算好的字符串，比如 RM 12.90）；拿不到返回 null */
export async function price(): Promise<string | null> {
  if (platform() === 'web') return null;
  try {
    const m = await np();
    const r = await m.NativePurchases.getProducts({ productIdentifiers: [PRODUCT], productType: m.PURCHASE_TYPE.INAPP });
    return r.products[0]?.priceString || null;
  } catch { return null; }
}

/** 结果：ok 解锁了；none 没找到购买；pending 还没付完；cancel 用户取消；net 服务器连不上（商店那边已付，之后恢复购买即可） */
export type Result = 'ok' | 'none' | 'pending' | 'cancel' | 'net' | 'error';

async function verify(tx: { transactionId: string; purchaseToken?: string }): Promise<Result> {
  const p = platform();
  const token = p === 'ios' ? tx.transactionId : (tx.purchaseToken || tx.transactionId);
  try {
    const r = await api<{ ent: string }>('/iap/verify', { platform: p, productId: PRODUCT, token });
    save('ent', r.ent);
    return 'ok';
  } catch (e) {
    if (e instanceof ApiError && e.code === 'pending') return 'pending';
    if (e instanceof ApiError && e.status === 402) return 'none';
    return 'net';
  }
}

export async function buy(): Promise<Result> {
  const m = await np();
  let tx;
  try { tx = await m.NativePurchases.purchaseProduct({ productIdentifier: PRODUCT, productType: m.PURCHASE_TYPE.INAPP, quantity: 1 }); }
  catch (e) {
    const s = String((e as { message?: string; code?: string })?.message || e).toLowerCase();
    if (/cancel/.test(s)) return 'cancel';
    if (/already.?own/.test(s)) return restore(false);   // Android：已经买过 → 直接找回
    return 'error';
  }
  return verify(tx);
}

/** 找回买过的。sync = 先让商店同步一次（用户点「恢复购买」时；iOS 可能会要求登录 Apple ID）；App 启动时静默检查用 false */
export async function restore(sync = true): Promise<Result> {
  try {
    const m = await np();
    if (sync) await m.NativePurchases.restorePurchases();
    const { purchases } = await m.NativePurchases.getPurchases({ productType: m.PURCHASE_TYPE.INAPP });
    const tx = purchases.find((x) => x.productIdentifier === PRODUCT);
    return tx ? verify(tx) : 'none';
  } catch { return 'error'; }
}
