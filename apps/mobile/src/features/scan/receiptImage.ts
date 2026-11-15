/**
 * Receipt photos shown in the app (Phase 8D.3). The review screen may load the photo from a
 * short-lived signed Storage URL. expo-image would otherwise also keep a copy in its disk
 * cache, outliving both the 10-minute URL and the receipt itself (a deleted receipt's photo
 * would stay on the phone). Memory only: the photo is gone when the app closes.
 */
export const RECEIPT_IMAGE_CACHE_POLICY = 'memory' as const;
