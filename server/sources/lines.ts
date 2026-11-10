// Numéros de ligne Irigo, communs au temps réel (SIRI, irigo.ts) et aux horaires théoriques (GTFS, gtfs.ts) : les
// deux sources les écrivent différemment (« 03 » ou « 3 »), on les compare toujours sous la même forme.

/** « 03 » → « 3 » ; « A » reste « A ». Les lignes du flux d'alertes et de SIRI se comparent ainsi. */
export const lineLabel = (ref: string) => ref.trim().replace(/^0+(?=\w)/u, '');
