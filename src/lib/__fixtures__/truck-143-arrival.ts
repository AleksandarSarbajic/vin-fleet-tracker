/**
 * Truck 143 arriving at 1804 N Washington St, Grand Forks ND — REAL positions,
 * captured verbatim from the `positions` table on 2026-09-17.
 *
 * Not invented and not rounded. 194 fixes spanning
 * 2026-09-17T20:05:03.527Z to 2026-09-17T20:32:08.033Z,
 * NEWEST FIRST, exactly as the query returns them.
 *
 * This started as a live query against the database. That worked for about
 * four hours and then failed, because the truck left Grand Forks and the
 * window no longer contained an arrival — a test whose result depended on
 * where a lorry happened to be. Capturing the track keeps what made it worth
 * having (the radius was validated against reality, not against my
 * assumptions) and drops what made it useless (it only worked that afternoon).
 *
 * The stop's coordinates are the ones the Census geocoder actually returned.
 */
export const GRAND_FORKS_STOP = { lat: 47.936987136499, lng: -97.057368543984 };

export const TRUCK_143_ARRIVING = [
  {
    "lat": 47.938855,
    "lng": -97.057121,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:32:08.033Z"
  },
  {
    "lat": 47.93885,
    "lng": -97.057118,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:31:57.012Z"
  },
  {
    "lat": 47.938851,
    "lng": -97.057063,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:29:50.021Z"
  },
  {
    "lat": 47.938851,
    "lng": -97.057082,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:29:42.020Z"
  },
  {
    "lat": 47.938842,
    "lng": -97.057109,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:29:36.074Z"
  },
  {
    "lat": 47.938821,
    "lng": -97.057109,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:29:29.023Z"
  },
  {
    "lat": 47.938826,
    "lng": -97.057086,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:29:23.046Z"
  },
  {
    "lat": 47.938928,
    "lng": -97.057091,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:28:17.034Z"
  },
  {
    "lat": 47.938917,
    "lng": -97.057093,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:28:12.026Z"
  },
  {
    "lat": 47.938911,
    "lng": -97.057113,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:28:06.033Z"
  },
  {
    "lat": 47.938916,
    "lng": -97.057129,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:28:01.031Z"
  },
  {
    "lat": 47.938918,
    "lng": -97.057133,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:27:56.013Z"
  },
  {
    "lat": 47.938901,
    "lng": -97.057122,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:27:33.030Z"
  },
  {
    "lat": 47.938894,
    "lng": -97.057125,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:27:28.028Z"
  },
  {
    "lat": 47.938859,
    "lng": -97.057121,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:27:22.031Z"
  },
  {
    "lat": 47.938834,
    "lng": -97.057115,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:27:16.037Z"
  },
  {
    "lat": 47.938825,
    "lng": -97.057089,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:27:08.038Z"
  },
  {
    "lat": 47.93879,
    "lng": -97.057086,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:27:01.012Z"
  },
  {
    "lat": 47.938761,
    "lng": -97.057083,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:26:56.032Z"
  },
  {
    "lat": 47.938743,
    "lng": -97.057081,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:26:50.033Z"
  },
  {
    "lat": 47.938723,
    "lng": -97.057083,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:26:42.020Z"
  },
  {
    "lat": 47.938701,
    "lng": -97.057103,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:26:37.023Z"
  },
  {
    "lat": 47.938728,
    "lng": -97.05711,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:26:31.079Z"
  },
  {
    "lat": 47.938726,
    "lng": -97.057103,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:26:26.028Z"
  },
  {
    "lat": 47.938703,
    "lng": -97.057096,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:26:18.075Z"
  },
  {
    "lat": 47.93872,
    "lng": -97.057089,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:26:12.020Z"
  },
  {
    "lat": 47.938703,
    "lng": -97.057075,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:26:00.026Z"
  },
  {
    "lat": 47.938706,
    "lng": -97.057085,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:25:55.036Z"
  },
  {
    "lat": 47.938714,
    "lng": -97.057091,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:25:49.034Z"
  },
  {
    "lat": 47.938723,
    "lng": -97.057097,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:25:44.014Z"
  },
  {
    "lat": 47.938762,
    "lng": -97.057099,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:25:38.028Z"
  },
  {
    "lat": 47.938771,
    "lng": -97.057114,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:25:33.038Z"
  },
  {
    "lat": 47.938766,
    "lng": -97.057121,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:25:26.119Z"
  },
  {
    "lat": 47.938766,
    "lng": -97.05711,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:25:20.028Z"
  },
  {
    "lat": 47.938771,
    "lng": -97.057099,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:25:14.032Z"
  },
  {
    "lat": 47.938784,
    "lng": -97.057111,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:24:54.006Z"
  },
  {
    "lat": 47.938787,
    "lng": -97.057122,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:24:44.023Z"
  },
  {
    "lat": 47.938789,
    "lng": -97.057114,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:24:31.017Z"
  },
  {
    "lat": 47.938787,
    "lng": -97.057153,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:22:43.036Z"
  },
  {
    "lat": 47.938768,
    "lng": -97.057162,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:22:38.040Z"
  },
  {
    "lat": 47.938746,
    "lng": -97.057139,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:22:32.024Z"
  },
  {
    "lat": 47.938742,
    "lng": -97.057145,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:22:25.028Z"
  },
  {
    "lat": 47.938781,
    "lng": -97.057138,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:22:10.021Z"
  },
  {
    "lat": 47.938788,
    "lng": -97.057135,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:22:04.016Z"
  },
  {
    "lat": 47.9388,
    "lng": -97.057141,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:21:58.042Z"
  },
  {
    "lat": 47.938778,
    "lng": -97.057111,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:21:51.043Z"
  },
  {
    "lat": 47.938774,
    "lng": -97.057092,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:21:43.083Z"
  },
  {
    "lat": 47.93877,
    "lng": -97.057096,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:21:38.036Z"
  },
  {
    "lat": 47.938766,
    "lng": -97.057102,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:21:31.029Z"
  },
  {
    "lat": 47.938747,
    "lng": -97.057121,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:21:26.010Z"
  },
  {
    "lat": 47.938755,
    "lng": -97.057113,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:21:21.019Z"
  },
  {
    "lat": 47.938788,
    "lng": -97.057121,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:21:05.028Z"
  },
  {
    "lat": 47.938812,
    "lng": -97.057129,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:20:59.034Z"
  },
  {
    "lat": 47.938821,
    "lng": -97.057114,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:20:52.065Z"
  },
  {
    "lat": 47.938833,
    "lng": -97.057094,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:20:46.052Z"
  },
  {
    "lat": 47.938815,
    "lng": -97.057104,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:20:38.039Z"
  },
  {
    "lat": 47.938803,
    "lng": -97.057108,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:20:31.030Z"
  },
  {
    "lat": 47.938806,
    "lng": -97.05713,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:20:25.046Z"
  },
  {
    "lat": 47.938805,
    "lng": -97.057131,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:20:19.511Z"
  },
  {
    "lat": 47.938804,
    "lng": -97.05714,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:20:11.037Z"
  },
  {
    "lat": 47.938807,
    "lng": -97.057143,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:20:05.514Z"
  },
  {
    "lat": 47.938786,
    "lng": -97.057157,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:19:57.513Z"
  },
  {
    "lat": 47.938777,
    "lng": -97.05715,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:19:52.512Z"
  },
  {
    "lat": 47.938768,
    "lng": -97.057149,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:19:45.028Z"
  },
  {
    "lat": 47.938771,
    "lng": -97.05715,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:19:40.504Z"
  },
  {
    "lat": 47.938757,
    "lng": -97.057158,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:19:34.510Z"
  },
  {
    "lat": 47.938738,
    "lng": -97.057196,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:19:27.019Z"
  },
  {
    "lat": 47.938742,
    "lng": -97.057198,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:19:22.021Z"
  },
  {
    "lat": 47.938767,
    "lng": -97.057214,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:19:16.023Z"
  },
  {
    "lat": 47.938774,
    "lng": -97.057211,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:19:08.024Z"
  },
  {
    "lat": 47.938821,
    "lng": -97.057185,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:19:02.080Z"
  },
  {
    "lat": 47.938811,
    "lng": -97.057133,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:18:55.025Z"
  },
  {
    "lat": 47.938829,
    "lng": -97.057122,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:18:50.026Z"
  },
  {
    "lat": 47.938898,
    "lng": -97.057113,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:18:31.502Z"
  },
  {
    "lat": 47.938917,
    "lng": -97.057118,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:18:25.505Z"
  },
  {
    "lat": 47.938917,
    "lng": -97.057115,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:18:11.027Z"
  },
  {
    "lat": 47.938906,
    "lng": -97.057088,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:18:05.012Z"
  },
  {
    "lat": 47.938886,
    "lng": -97.057081,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:17:58.045Z"
  },
  {
    "lat": 47.938875,
    "lng": -97.05708,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:17:52.032Z"
  },
  {
    "lat": 47.938887,
    "lng": -97.05707,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:17:45.013Z"
  },
  {
    "lat": 47.938864,
    "lng": -97.057063,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:17:38.023Z"
  },
  {
    "lat": 47.938867,
    "lng": -97.05707,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:17:28.050Z"
  },
  {
    "lat": 47.93884,
    "lng": -97.057094,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:17:20.021Z"
  },
  {
    "lat": 47.938836,
    "lng": -97.057104,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:17:00.022Z"
  },
  {
    "lat": 47.938843,
    "lng": -97.057106,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:16:55.013Z"
  },
  {
    "lat": 47.93884,
    "lng": -97.057102,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:16:48.036Z"
  },
  {
    "lat": 47.93884,
    "lng": -97.057104,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:16:42.015Z"
  },
  {
    "lat": 47.938816,
    "lng": -97.057099,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:16:34.024Z"
  },
  {
    "lat": 47.938789,
    "lng": -97.057095,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:16:28.041Z"
  },
  {
    "lat": 47.938788,
    "lng": -97.057097,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:16:23.050Z"
  },
  {
    "lat": 47.938795,
    "lng": -97.057108,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:16:17.010Z"
  },
  {
    "lat": 47.938794,
    "lng": -97.057108,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:16:11.021Z"
  },
  {
    "lat": 47.938813,
    "lng": -97.0571,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:16:05.035Z"
  },
  {
    "lat": 47.938801,
    "lng": -97.05712,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:15:59.023Z"
  },
  {
    "lat": 47.938794,
    "lng": -97.057156,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:15:49.033Z"
  },
  {
    "lat": 47.938758,
    "lng": -97.057222,
    "speedMph": 1.23,
    "recordedAtUtc": "2026-09-17T20:15:37.014Z"
  },
  {
    "lat": 47.938776,
    "lng": -97.057202,
    "speedMph": 2.482,
    "recordedAtUtc": "2026-09-17T20:15:32.013Z"
  },
  {
    "lat": 47.938805,
    "lng": -97.057117,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:15:25.104Z"
  },
  {
    "lat": 47.938808,
    "lng": -97.057129,
    "speedMph": 1.23,
    "recordedAtUtc": "2026-09-17T20:15:19.038Z"
  },
  {
    "lat": 47.938775,
    "lng": -97.057193,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:15:09.036Z"
  },
  {
    "lat": 47.938773,
    "lng": -97.057257,
    "speedMph": 2.482,
    "recordedAtUtc": "2026-09-17T20:15:01.023Z"
  },
  {
    "lat": 47.93871,
    "lng": -97.057407,
    "speedMph": 1.856,
    "recordedAtUtc": "2026-09-17T20:14:49.025Z"
  },
  {
    "lat": 47.938686,
    "lng": -97.057454,
    "speedMph": 3.086,
    "recordedAtUtc": "2026-09-17T20:14:43.052Z"
  },
  {
    "lat": 47.938734,
    "lng": -97.057355,
    "speedMph": 1.23,
    "recordedAtUtc": "2026-09-17T20:14:37.032Z"
  },
  {
    "lat": 47.938731,
    "lng": -97.057404,
    "speedMph": 1.856,
    "recordedAtUtc": "2026-09-17T20:14:29.014Z"
  },
  {
    "lat": 47.938677,
    "lng": -97.057487,
    "speedMph": 2.482,
    "recordedAtUtc": "2026-09-17T20:14:20.505Z"
  },
  {
    "lat": 47.938631,
    "lng": -97.057535,
    "speedMph": 2.482,
    "recordedAtUtc": "2026-09-17T20:14:15.506Z"
  },
  {
    "lat": 47.938603,
    "lng": -97.057584,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:14:09.500Z"
  },
  {
    "lat": 47.938594,
    "lng": -97.057561,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:14:03.524Z"
  },
  {
    "lat": 47.938568,
    "lng": -97.057542,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:13:57.031Z"
  },
  {
    "lat": 47.938548,
    "lng": -97.057528,
    "speedMph": 0.603,
    "recordedAtUtc": "2026-09-17T20:13:52.015Z"
  },
  {
    "lat": 47.938563,
    "lng": -97.057522,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:13:47.006Z"
  },
  {
    "lat": 47.93855,
    "lng": -97.057497,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:13:41.038Z"
  },
  {
    "lat": 47.938551,
    "lng": -97.057511,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:13:36.023Z"
  },
  {
    "lat": 47.938542,
    "lng": -97.05753,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:13:23.543Z"
  },
  {
    "lat": 47.938549,
    "lng": -97.057531,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:13:17.502Z"
  },
  {
    "lat": 47.938559,
    "lng": -97.057534,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:13:08.555Z"
  },
  {
    "lat": 47.938559,
    "lng": -97.057521,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:13:03.028Z"
  },
  {
    "lat": 47.938558,
    "lng": -97.057518,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:12:58.541Z"
  },
  {
    "lat": 47.938556,
    "lng": -97.057529,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:12:52.507Z"
  },
  {
    "lat": 47.93857,
    "lng": -97.05753,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:12:45.032Z"
  },
  {
    "lat": 47.938611,
    "lng": -97.057537,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:12:39.509Z"
  },
  {
    "lat": 47.938619,
    "lng": -97.05753,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:12:31.018Z"
  },
  {
    "lat": 47.93866,
    "lng": -97.057442,
    "speedMph": 8.075,
    "recordedAtUtc": "2026-09-17T20:12:25.016Z"
  },
  {
    "lat": 47.938763,
    "lng": -97.057174,
    "speedMph": 9.305,
    "recordedAtUtc": "2026-09-17T20:12:19.503Z"
  },
  {
    "lat": 47.938979,
    "lng": -97.057232,
    "speedMph": 9.931,
    "recordedAtUtc": "2026-09-17T20:12:13.517Z"
  },
  {
    "lat": 47.938948,
    "lng": -97.057584,
    "speedMph": 10.557,
    "recordedAtUtc": "2026-09-17T20:12:07.507Z"
  },
  {
    "lat": 47.938731,
    "lng": -97.057855,
    "speedMph": 12.415,
    "recordedAtUtc": "2026-09-17T20:12:01.500Z"
  },
  {
    "lat": 47.938541,
    "lng": -97.05814,
    "speedMph": 11.184,
    "recordedAtUtc": "2026-09-17T20:11:55.603Z"
  },
  {
    "lat": 47.938285,
    "lng": -97.058273,
    "speedMph": 11.184,
    "recordedAtUtc": "2026-09-17T20:11:47.503Z"
  },
  {
    "lat": 47.937922,
    "lng": -97.058347,
    "speedMph": 19.259,
    "recordedAtUtc": "2026-09-17T20:11:41.503Z"
  },
  {
    "lat": 47.937418,
    "lng": -97.058163,
    "speedMph": 27.962,
    "recordedAtUtc": "2026-09-17T20:11:35.512Z"
  },
  {
    "lat": 47.936945,
    "lng": -97.057536,
    "speedMph": 34.157,
    "recordedAtUtc": "2026-09-17T20:11:30.505Z"
  },
  {
    "lat": 47.936475,
    "lng": -97.056839,
    "speedMph": 32.927,
    "recordedAtUtc": "2026-09-17T20:11:25.505Z"
  },
  {
    "lat": 47.936042,
    "lng": -97.056151,
    "speedMph": 30.444,
    "recordedAtUtc": "2026-09-17T20:11:20.507Z"
  },
  {
    "lat": 47.935587,
    "lng": -97.055369,
    "speedMph": 28.565,
    "recordedAtUtc": "2026-09-17T20:11:14.499Z"
  },
  {
    "lat": 47.935167,
    "lng": -97.054613,
    "speedMph": 23.599,
    "recordedAtUtc": "2026-09-17T20:11:08.529Z"
  },
  {
    "lat": 47.93488,
    "lng": -97.054095,
    "speedMph": 23.599,
    "recordedAtUtc": "2026-09-17T20:11:03.511Z"
  },
  {
    "lat": 47.934575,
    "lng": -97.053534,
    "speedMph": 26.708,
    "recordedAtUtc": "2026-09-17T20:10:58.535Z"
  },
  {
    "lat": 47.934237,
    "lng": -97.052893,
    "speedMph": 27.334,
    "recordedAtUtc": "2026-09-17T20:10:53.519Z"
  },
  {
    "lat": 47.933173,
    "lng": -97.050711,
    "speedMph": 1.23,
    "recordedAtUtc": "2026-09-17T20:10:30.514Z"
  },
  {
    "lat": 47.933189,
    "lng": -97.050687,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:10:22.503Z"
  },
  {
    "lat": 47.933193,
    "lng": -97.050697,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:10:14.504Z"
  },
  {
    "lat": 47.933189,
    "lng": -97.050691,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:10:08.525Z"
  },
  {
    "lat": 47.933178,
    "lng": -97.05068,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:09:55.504Z"
  },
  {
    "lat": 47.933191,
    "lng": -97.050668,
    "speedMph": 3.086,
    "recordedAtUtc": "2026-09-17T20:09:43.494Z"
  },
  {
    "lat": 47.9332,
    "lng": -97.050389,
    "speedMph": 14.898,
    "recordedAtUtc": "2026-09-17T20:09:37.629Z"
  },
  {
    "lat": 47.93317,
    "lng": -97.048966,
    "speedMph": 17.38,
    "recordedAtUtc": "2026-09-17T20:09:21.573Z"
  },
  {
    "lat": 47.933175,
    "lng": -97.04812,
    "speedMph": 27.962,
    "recordedAtUtc": "2026-09-17T20:09:15.583Z"
  },
  {
    "lat": 47.93317,
    "lng": -97.047081,
    "speedMph": 29.818,
    "recordedAtUtc": "2026-09-17T20:09:09.535Z"
  },
  {
    "lat": 47.933171,
    "lng": -97.046178,
    "speedMph": 28.565,
    "recordedAtUtc": "2026-09-17T20:09:04.501Z"
  },
  {
    "lat": 47.933181,
    "lng": -97.045329,
    "speedMph": 27.962,
    "recordedAtUtc": "2026-09-17T20:08:59.502Z"
  },
  {
    "lat": 47.9332,
    "lng": -97.044381,
    "speedMph": 25.455,
    "recordedAtUtc": "2026-09-17T20:08:53.545Z"
  },
  {
    "lat": 47.933192,
    "lng": -97.043351,
    "speedMph": 30.444,
    "recordedAtUtc": "2026-09-17T20:08:47.507Z"
  },
  {
    "lat": 47.933193,
    "lng": -97.042432,
    "speedMph": 31.674,
    "recordedAtUtc": "2026-09-17T20:08:42.501Z"
  },
  {
    "lat": 47.933195,
    "lng": -97.041293,
    "speedMph": 32.927,
    "recordedAtUtc": "2026-09-17T20:08:36.499Z"
  },
  {
    "lat": 47.933166,
    "lng": -97.040321,
    "speedMph": 30.444,
    "recordedAtUtc": "2026-09-17T20:08:31.500Z"
  },
  {
    "lat": 47.933166,
    "lng": -97.039348,
    "speedMph": 34.157,
    "recordedAtUtc": "2026-09-17T20:08:26.499Z"
  },
  {
    "lat": 47.933207,
    "lng": -97.038098,
    "speedMph": 36.037,
    "recordedAtUtc": "2026-09-17T20:08:20.504Z"
  },
  {
    "lat": 47.933272,
    "lng": -97.036819,
    "speedMph": 34.157,
    "recordedAtUtc": "2026-09-17T20:08:14.502Z"
  },
  {
    "lat": 47.933349,
    "lng": -97.035614,
    "speedMph": 34.157,
    "recordedAtUtc": "2026-09-17T20:08:08.527Z"
  },
  {
    "lat": 47.933505,
    "lng": -97.034601,
    "speedMph": 36.663,
    "recordedAtUtc": "2026-09-17T20:08:03.531Z"
  },
  {
    "lat": 47.933829,
    "lng": -97.033328,
    "speedMph": 38.52,
    "recordedAtUtc": "2026-09-17T20:07:57.502Z"
  },
  {
    "lat": 47.934067,
    "lng": -97.032272,
    "speedMph": 37.267,
    "recordedAtUtc": "2026-09-17T20:07:52.502Z"
  },
  {
    "lat": 47.934263,
    "lng": -97.031171,
    "speedMph": 39.75,
    "recordedAtUtc": "2026-09-17T20:07:47.502Z"
  },
  {
    "lat": 47.93435,
    "lng": -97.02999,
    "speedMph": 39.75,
    "recordedAtUtc": "2026-09-17T20:07:42.504Z"
  },
  {
    "lat": 47.934349,
    "lng": -97.028577,
    "speedMph": 37.893,
    "recordedAtUtc": "2026-09-17T20:07:36.508Z"
  },
  {
    "lat": 47.934367,
    "lng": -97.02747,
    "speedMph": 36.037,
    "recordedAtUtc": "2026-09-17T20:07:31.501Z"
  },
  {
    "lat": 47.934422,
    "lng": -97.026414,
    "speedMph": 35.411,
    "recordedAtUtc": "2026-09-17T20:07:26.498Z"
  },
  {
    "lat": 47.934626,
    "lng": -97.025157,
    "speedMph": 35.411,
    "recordedAtUtc": "2026-09-17T20:07:20.503Z"
  },
  {
    "lat": 47.934891,
    "lng": -97.024151,
    "speedMph": 36.037,
    "recordedAtUtc": "2026-09-17T20:07:15.502Z"
  },
  {
    "lat": 47.935247,
    "lng": -97.022954,
    "speedMph": 35.411,
    "recordedAtUtc": "2026-09-17T20:07:09.505Z"
  },
  {
    "lat": 47.935579,
    "lng": -97.021815,
    "speedMph": 32.927,
    "recordedAtUtc": "2026-09-17T20:07:03.517Z"
  },
  {
    "lat": 47.93583,
    "lng": -97.020954,
    "speedMph": 27.962,
    "recordedAtUtc": "2026-09-17T20:06:58.520Z"
  },
  {
    "lat": 47.936051,
    "lng": -97.020167,
    "speedMph": 16.776,
    "recordedAtUtc": "2026-09-17T20:06:52.536Z"
  },
  {
    "lat": 47.936168,
    "lng": -97.019766,
    "speedMph": 8.075,
    "recordedAtUtc": "2026-09-17T20:06:47.496Z"
  },
  {
    "lat": 47.936197,
    "lng": -97.019655,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:06:41.503Z"
  },
  {
    "lat": 47.936163,
    "lng": -97.01967,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:06:36.501Z"
  },
  {
    "lat": 47.936124,
    "lng": -97.0197,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:06:30.506Z"
  },
  {
    "lat": 47.936084,
    "lng": -97.01972,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:06:23.517Z"
  },
  {
    "lat": 47.936114,
    "lng": -97.019585,
    "speedMph": 14.271,
    "recordedAtUtc": "2026-09-17T20:06:18.602Z"
  },
  {
    "lat": 47.936261,
    "lng": -97.019056,
    "speedMph": 24.225,
    "recordedAtUtc": "2026-09-17T20:06:13.531Z"
  },
  {
    "lat": 47.936535,
    "lng": -97.018117,
    "speedMph": 34.783,
    "recordedAtUtc": "2026-09-17T20:06:07.503Z"
  },
  {
    "lat": 47.936857,
    "lng": -97.016955,
    "speedMph": 35.411,
    "recordedAtUtc": "2026-09-17T20:06:01.497Z"
  },
  {
    "lat": 47.937126,
    "lng": -97.015992,
    "speedMph": 34.783,
    "recordedAtUtc": "2026-09-17T20:05:56.496Z"
  },
  {
    "lat": 47.93739,
    "lng": -97.015031,
    "speedMph": 34.783,
    "recordedAtUtc": "2026-09-17T20:05:51.494Z"
  },
  {
    "lat": 47.937708,
    "lng": -97.013896,
    "speedMph": 31.07,
    "recordedAtUtc": "2026-09-17T20:05:45.496Z"
  },
  {
    "lat": 47.937946,
    "lng": -97.013087,
    "speedMph": 22.973,
    "recordedAtUtc": "2026-09-17T20:05:40.493Z"
  },
  {
    "lat": 47.938128,
    "lng": -97.012418,
    "speedMph": 12.415,
    "recordedAtUtc": "2026-09-17T20:05:34.494Z"
  },
  {
    "lat": 47.938181,
    "lng": -97.012148,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:05:28.528Z"
  },
  {
    "lat": 47.938182,
    "lng": -97.012152,
    "speedMph": 0,
    "recordedAtUtc": "2026-09-17T20:05:20.504Z"
  },
  {
    "lat": 47.938237,
    "lng": -97.011925,
    "speedMph": 18.006,
    "recordedAtUtc": "2026-09-17T20:05:14.508Z"
  },
  {
    "lat": 47.93837,
    "lng": -97.011327,
    "speedMph": 26.708,
    "recordedAtUtc": "2026-09-17T20:05:09.502Z"
  },
  {
    "lat": 47.938528,
    "lng": -97.010309,
    "speedMph": 34.157,
    "recordedAtUtc": "2026-09-17T20:05:03.527Z"
  }
] as const;
