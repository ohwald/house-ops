// lib/geo.mjs — 房源与地标地理编码缓存与解析
// 规范：零依赖。优先使用本地缓存 data/.geo-cache.json，避免重复请求。

import { readFile, writeFile } from 'node:fs/promises';

/**
 * 生成规范化的地址缓存 Key
 */
export function makeGeoKey(city, district, communityOrAddress) {
  const parts = [city ?? '', district ?? '', communityOrAddress ?? '']
    .map(s => String(s).trim())
    .filter(Boolean);
  return parts.join('·');
}

/**
 * 读取本地地理编码缓存
 */
export async function loadGeoCache(cachePath) {
  try {
    const raw = await readFile(cachePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * 保存地理编码缓存
 */
export async function saveGeoCache(cachePath, cache) {
  try {
    await writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('保存地理编码缓存失败:', err.message);
    return false;
  }
}

/**
 * 若配置了 AMAP_KEY，可用高德 Web API 服务端预解析
 */
export async function geocodeServer(address, city = '', amapKey = '') {
  if (!address || !amapKey) return null;
  const url = `https://restapi.amap.com/v3/geocode/geo?key=${encodeURIComponent(amapKey)}&address=${encodeURIComponent(address)}&city=${encodeURIComponent(city)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === '1' && Array.isArray(data.geocodes) && data.geocodes.length > 0) {
      const [lng, lat] = data.geocodes[0].location.split(',').map(Number);
      if (!Number.isNaN(lng) && !Number.isNaN(lat)) {
        return [lng, lat];
      }
    }
  } catch {
    // 静默降级给前端 Geocoder 处理
  }
  return null;
}
