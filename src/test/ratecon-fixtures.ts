import type { TinyRun } from './tiny-pdf';

/**
 * §12.122. Invented rate confirmations, one per layout the fill reads. The
 * SHAPES are the layouts' — labels, columns, a page break, a wrapped date, a
 * facility code between lines, a state and ZIP in one run — and every value
 * is made up: companies, streets, numbers, amounts. No real document's text
 * is here, and none may be.
 *
 * Each is pages of text runs, so a test can read them as lines directly or
 * build a real PDF from them (`tinyPdf`) and read that through pdf.js.
 */

const run = (x: number, y: number, text: string): TinyRun => ({ x, y, text });

/** Label rows: PICKUP DATE / SHIPPER / ADDRESS / CITY, STATE, then DELIVERY. */
export const LABEL_ROWS: TinyRun[][] = [
  [
    run(204, 747, 'ORDER CONFIRMATION'),
    run(227, 723, 'Order ID'),
    run(312, 723, 'EXAMPLE FREIGHT, INC.'),
    run(228, 708, '550123'),
    run(63, 654, 'CARRIER'),
    run(108, 654, 'SAMPLE CARRIER LLC'),
    run(45, 609, 'PICKUP DATE'),
    run(108, 609, '10/12/2026 (Monday) PICKUP TIME: 7:30AM APPT'),
    run(64, 597, 'SHIPPER'),
    run(108, 597, 'PRAIRIE COLD STORAGE'),
    run(60, 588, 'ADDRESS'),
    run(108, 588, '4001 MAIN ST'),
    run(50, 579, 'CITY, STATE'),
    run(108, 579, 'FARGO, ND 58102'),
    run(27, 441, 'RATE TO CHARGE'),
    run(108, 441, '$1,234.00'),
    run(35, 426, 'DELIVERY DATE'),
    run(108, 426, '10/13/2026 (Tuesday) DELIVERY TIME: 0800-0930 APPT'),
    run(51, 417, 'CONSIGNEE'),
    run(108, 417, 'LAKESIDE DC'),
    run(60, 405, 'ADDRESS'),
    run(108, 405, '1200 HARBOR RD'),
    run(50, 396, 'CITY, STATE'),
    run(108, 396, 'DICKINSON, ND 58601'),
    run(67, 204, 'BILLING'),
    run(108, 204, 'EXAMPLE FREIGHT, INC.'),
    run(108, 195, '100 BILLING WAY'),
    run(108, 183, 'TOLEDO, OH 43604'),
  ],
];

/** A Stops section at the end: two columns, stop 1 at the foot of page 1, a date wrapped. */
export const STOPS_SECTION: TinyRun[][] = [
  [
    run(450, 760, 'Example Logistics'),
    run(446, 745, 'Rate Confirmation'),
    run(455, 730, 'LOAD ID: 77001'),
    run(30, 700, 'Shipper'),
    run(308, 700, 'Consignee'),
    run(30, 691, 'PRAIRIE COLD STORAGE'),
    run(308, 691, 'Lakeside DC'),
    run(31, 159, 'Shipping Charges'),
    run(103, 159, '$999.00'),
    run(29, 90, 'Stops'),
    run(30, 69, 'Stop 1 Pickup'),
    run(30, 60, 'Customer'),
    run(30, 48, 'PRAIRIE COLD STORAGE'),
    run(308, 48, 'Date:'),
    run(332, 48, 'Monday, October 12, 2026 08:00 -'),
    run(483, 48, 'Monday,'),
    run(30, 39, '4001 Main St'),
    run(308, 39, 'October 12, 2026 09:30'),
    run(30, 30, 'Fargo, ND 58102'),
    run(308, 30, 'APPT'),
  ],
  [
    run(30, 770, 'Stop 2 Drop'),
    run(30, 758, 'Customer'),
    run(30, 749, 'Lakeside DC'),
    run(308, 749, 'Date:'),
    run(332, 749, 'Tuesday, October 13, 2026 07:00 -'),
    run(472, 749, 'Tuesday, October 13,'),
    run(30, 740, '1200 Harbor Rd'),
    run(308, 740, '2026 15:00'),
    run(30, 731, 'Dickinson, ND 58601'),
    run(308, 731, 'APPT'),
    run(29, 701, '1. Example terms and conditions apply to this load.'),
  ],
];

export interface BlockStop {
  kind: 'PU' | 'SO';
  name: string;
  street: string;
  /** "FARGO  ND  58102" as separate runs, or one run "ND 58102". */
  city: string;
  state: string;
  zip: string;
  merged?: boolean;
  /** A facility code on its own line between the address and the city. */
  code?: string;
  from: string;
  to: string;
}

/** PU / SO blocks: Name and Date, then Address and a second date, then the city line. */
export function puSoBlocks(stops: BlockStop[], numberLabel: 'Order:' | 'Load Number:' = 'Order:'): TinyRun[][] {
  const head = [
    run(237, 765, '*** Load Confirmation ***'),
    run(34, 753, 'Example Brokerage LLC'),
    run(34, 666, 'Date:'),
    run(96, 666, '10/01/2026'),
    numberLabel === 'Order:' ? run(34, 642, 'Order') : run(34, 642, 'Example'),
    run(100, 642, numberLabel),
    run(160, 642, '88123'),
  ];
  const pages: TinyRun[][] = [head];
  let y = 600;
  for (const [i, s] of stops.entries()) {
    if (y < 120) {
      pages.push([]);
      y = 760;
    }
    const page = pages[pages.length - 1]!;
    const label = `${s.kind} ${i + 1}`;
    page.push(
      run(92, y, label),
      run(129, y, 'Name:'),
      run(183, y, s.name),
      run(370, y, 'Date:'),
      run(433, y, s.from),
      run(129, y - 12, 'Address:'),
      run(183, y - 12, s.street),
      run(433, y - 12, s.to),
    );
    if (s.code) page.push(run(70, y - 21, s.code));
    page.push(run(183, y - 27, s.city));
    if (s.merged) page.push(run(275, y - 27, `${s.state} ${s.zip}`));
    else page.push(run(275, y - 27, s.state), run(296, y - 27, s.zip));
    page.push(
      run(370, y - 27, 'Contact:'),
      run(433, y - 27, 'Dock'),
      run(129, y - 39, 'Phone:'),
      run(192, y - 39, '(555) 010-0000'),
      run(370, y - 39, 'Driver Load:'),
      run(433, y - 39, 'N'),
    );
    y -= 63;
  }
  return pages;
}

export const PU_SO: BlockStop[] = [
  {
    kind: 'PU',
    name: 'Prairie Cold Storage',
    street: '4001 Main St',
    city: 'FARGO',
    state: 'ND',
    zip: '58102',
    merged: true,
    code: 'PRAIRIE7',
    from: '10/12/2026 0800',
    to: '10/12/2026 0800',
  },
  {
    kind: 'SO',
    name: 'Lakeside DC',
    street: '1200 Harbor Rd',
    city: 'DICKINSON',
    state: 'ND',
    zip: '58601',
    from: '10/13/2026 0700',
    to: '10/13/2026 1500',
  },
];

/** The same document as text, as it might be pasted out of a PDF viewer. */
export const PU_SO_PASTED = [
  '*** Load Confirmation ***',
  'Example Brokerage LLC',
  'Order Order: 88123',
  'PU 1 Name: Prairie Cold Storage Date: 10/12/2026 0800',
  'Address: 4001 Main St 10/12/2026 0800',
  'FARGO ND 58102 Contact: Dock',
  'Phone: (555) 010-0000 Driver Load: N',
  'SO 2 Name: Lakeside DC Date: 10/13/2026 0700',
  'Address: 1200 Harbor Rd 10/13/2026 1500',
  'DICKINSON ND 58601 Contact: Dock',
  'Phone: (555) 010-0000 Driver Load: N',
].join('\n');

export interface ColumnsStop {
  kind: 'Pickup' | 'Delivery';
  name: string;
  street: string;
  /** The whole city line, as one run: "Fargo, ND 58102". */
  cityLine: string;
  /** One date and time, or Earliest and Latest. "Oct 12, 2026", "14:00 CDT". */
  when: { date: string; time: string } | { from: [string, string]; to: [string, string] };
  appt: 'By Appointment' | 'FCFS';
}

/**
 * §12.125. Pickup # / Delivery # blocks: three pages like the layout's —
 * a header on every page (its own address in one run), the load page with
 * "Arrive Order", "Load #" and "Shipment ID" side by side and the rate
 * details, the stops page with the billing address after the last stop,
 * and a terms page. Address and appointment in their own columns.
 */
export function pickupDeliveryColumns(stops: ColumnsStop[]): TinyRun[][] {
  const header = (): TinyRun[] => [
    run(212, 772, 'Example Freight Partners, an Example company'),
    run(212, 762, '9000 Sample Pkwy | Suite 100, Austin, TX 78701 | Phone: (555) 010-0100'),
    run(212, 752, 'Questions? Call carrier sales for load information'),
    run(212, 742, 'at (555) 010-0101 and reference order 4455001'),
  ];
  const loadPage: TinyRun[] = [
    ...header(),
    run(22, 700, 'Load'),
    run(208, 700, 'Carrier'),
    run(401, 700, 'Truck'),
    run(23, 688, 'Arrive Order'),
    run(110, 688, '4455001'),
    run(209, 688, 'Carrier'),
    run(299, 688, 'Sample Carrier LLC'),
    run(402, 688, 'Equipment'),
    run(490, 688, 'Van'),
    run(23, 676, 'Load #'),
    run(110, 676, '5566001'),
    run(23, 664, 'Total Miles'),
    run(110, 664, '612 Miles'),
    run(23, 652, 'Shipment ID'),
    run(110, 652, '7788990'),
    run(23, 630, 'Rate Details'),
    run(23, 618, 'LineHaul'),
    run(158, 618, '$1,900.00'),
    run(23, 606, 'Total'),
    run(151, 606, '$1,900.00'),
    run(52, 560, 'PAYMENT TERMS'),
    run(82, 548, 'Example payment terms apply to this load.'),
  ];
  const stopsPage: TinyRun[] = header();
  let y = 712;
  for (const [i, s] of stops.entries()) {
    const nth = stops.slice(0, i + 1).filter((t) => t.kind === s.kind).length;
    stopsPage.push(
      run(22, y, `${s.kind} #${nth}`),
      run(23, y - 12, `${s.kind} Address`),
      run(135, y - 12, 'Appointment'),
      run(222, y - 12, 'PO#'),
      run(366, y - 12, 'Commodity'),
      run(478, y - 12, 'Weight'),
      run(23, y - 24, s.name),
      run(223, y - 24, 'Appointment #'),
      run(294, y - 24, `A-${100 + i}`),
      run(366, y - 24, 'General Freight'),
      run(478, y - 24, '20000 lbs'),
      run(23, y - 36, s.street),
      run(223, y - 36, 'PO #'),
      run(294, y - 36, `P-${200 + i}`),
      run(23, y - 48, s.cityLine),
    );
    const column =
      'date' in s.when
        ? [s.when.date, s.when.time]
        : ['Earliest Time', ...s.when.from, 'Latest Time', ...s.when.to];
    column.forEach((text, k) => stopsPage.push(run(135, y - 36 - 12 * k, text)));
    let z = y - 36 - 12 * column.length;
    stopsPage.push(
      run(135, z, 'Load Type'),
      run(135, z - 12, 'Live Load'),
      run(135, z - 24, 'Appt. Type'),
      run(135, z - 36, s.appt),
      run(22, z - 48, 'Driver Instructions:'),
      run(93, z - 48, s.appt.toUpperCase()),
      run(22, z - 60, `${s.kind} Notes:`),
      run(92, z - 60, 'Bring the BOL; check in at the window.'),
    );
    z -= 60;
    y = z - 24;
  }
  stopsPage.push(
    run(201, y, 'Please email invoices or mail to:'),
    run(242, y - 12, 'Example Freight Partners, an Example company'),
    run(254, y - 24, '9000 Sample Pkwy | Suite 100'),
    run(275, y - 36, 'Austin, TX 78701'),
    run(231, y - 48, 'Ph# (555) 010-0100 FAX (555) 010-0102'),
  );
  const termsPage: TinyRun[] = [
    ...header(),
    run(22, 700, 'Load requirements: the driver must check in on arrival.'),
    run(43, 680, '1.'),
    run(52, 680, 'Example terms and conditions apply to this load.'),
  ];
  return [loadPage, stopsPage, termsPage];
}

export interface RouteStop {
  kind: 'Pickup' | 'Delivery';
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  /** Beside the address: "Oct 12, 2026". */
  date: string;
  /** Beside the stop's number: "14:30 Apt" in one run, or ["08:00", "Apt"] in two. */
  time: string | [string, string];
  number: string;
}

/**
 * Phase 3aa. Route blocks: a header on every page ("Page N", "Shipment ID",
 * "Rate Confirmation", a date and the ID), the stops in three columns opened
 * by "Route", four lines a stop with the street and city in ONE run, then a
 * summary line naming the first and the last facility with city and state,
 * the equipment, carrier and rate, and a page of terms. ASCII only: `tinyPdf`
 * counts its offsets in characters.
 */
export function routeBlocks(stops: RouteStop[], summary?: string): TinyRun[][] {
  const header = (page: number): TinyRun[] => [
    run(42, 770, `Page ${page}`),
    run(508, 770, 'Shipment ID'),
    run(255, 758, 'Rate Confirmation'),
    run(42, 746, 'Oct 1, 2026'),
    run(492, 746, '40000-100001'),
  ];
  const first: TinyRun[] = [...header(1), run(114, 734, 'Contact: Dana Example - P: (555) 010-0100 - E: dispatch@example.com')];
  let y = 710;
  for (const [i, s] of stops.entries()) {
    if (i === 0) first.push(run(49, y, 'Route'));
    first.push(
      run(241, y, s.kind),
      run(298, y, s.name),
      run(229, y - 12, s.date),
      run(298, y - 12, `${s.street} ${s.city}, ${s.state} ${s.zip}`),
      ...(typeof s.time === 'string' ? [run(236, y - 24, s.time)] : [run(235, y - 24, s.time[0]), run(261, y - 24, s.time[1])]),
      run(298, y - 24, `${s.kind} # ${s.number} - Live (1 Shipment)`),
      run(298, y - 36, 'dock_check_in-EXA'),
    );
    y -= 48;
  }
  const [a, z] = [stops[0]!, stops.at(-1)!];
  first.push(
    run(49, y, '**Example: the driver checks in at the window**'),
    run(49, y - 12, 'Lane'),
    run(117, y - 12, 'Summary'),
    run(117, y - 24, summary ?? `${a.name} (${a.city}, ${a.state}) > ${z.name} (${z.city}, ${z.state})`),
    run(117, y - 36, '1 Shipment - Weight : 20,000 lb'),
    run(49, y - 48, 'Equipment'),
    run(118, y - 48, 'Van - dry'),
    run(49, y - 60, 'Carrier'),
    run(117, y - 60, 'Sample Carrier LLC'),
    run(117, y - 72, 'P: (555) 010-0102'),
    run(49, y - 84, 'Rate'),
    run(117, y - 84, 'Linehaul - flat'),
    run(320, y - 84, '$1,900.00'),
    run(117, y - 96, 'Total'),
    run(320, y - 96, '$1,900.00'),
  );
  const terms: TinyRun[] = [
    ...header(2),
    run(51, 710, 'Example terms and conditions'),
    run(58, 698, '1.'),
    run(69, 698, 'This is the Carrier Rate Confirmation sheet. It is not a BOL.'),
  ];
  return [first, terms];
}

export const ROUTE_STOPS: RouteStop[] = [
  {
    kind: 'Pickup',
    name: 'Prairie Cold Storage',
    street: '4001 Main St',
    city: 'Fargo',
    state: 'ND',
    zip: '58102',
    date: 'Oct 12, 2026',
    time: '14:30 Apt',
    number: '10000001',
  },
  {
    kind: 'Delivery',
    name: 'Lakeside DC',
    street: '1200 Harbor Rd Unit 4',
    city: 'West Fargo',
    state: 'ND',
    zip: '58078',
    date: 'Oct 13, 2026',
    time: ['08:00', 'Apt'],
    number: '20000001',
  },
];

export const COLUMNS_STOPS: ColumnsStop[] = [
  {
    kind: 'Pickup',
    name: 'Prairie Cold Storage',
    street: '4001 Main St',
    cityLine: 'Fargo, ND 58102',
    when: { date: 'Oct 12, 2026', time: '14:30 CDT' },
    appt: 'By Appointment',
  },
  {
    kind: 'Delivery',
    name: 'Lakeside DC',
    street: '1200 Harbor Rd',
    cityLine: 'Dickinson, ND 58601',
    when: { from: ['Oct 13, 2026', '07:00 MDT'], to: ['Oct 13, 2026', '09:00 MDT'] },
    appt: 'FCFS',
  },
];

export interface TableStop {
  type: 'PU' | 'Del';
  /** Month and day, no year, as the layout prints them: "10/12". */
  from: string;
  to: string;
  /** "08:00". */
  fromTime: string;
  toTime: string;
  name: string;
  city: string;
  state: string;
  ref: string;
  appt: 'Yes' | 'No';
  street: string;
  phone: string;
  zip: string;
  apptRef: string;
  notes?: string;
}

/**
 * Phase 3ak. A stop table: a "LOAD NUMBER" box at the top right with the
 * number and the document's date under it; the stops in one table under a
 * two-line header ("Stop From To Name City St Ref Appt", "Address Phone Zip
 * Contact Appt Ref"), two lines a stop and a "Notes" line after some; then
 * "Commodity", the rate, and a page of terms that repeats the number as
 * "Load No <n> - <date>". The columns sit where the layout prints them. Only
 * the printed headings are the layout's: every value is made up. ASCII only.
 */
export function stopTable(
  stops: TableStop[],
  options: { loadNumber?: string; later?: string; date?: string; laterDate?: string } = {},
): TinyRun[][] {
  const { loadNumber = '610042', date = '10/9/2026', laterDate = '10/9/26' } = options;
  const later = options.later ?? loadNumber;
  const first: TinyRun[] = [
    run(154, 758, 'SAMPLE BROKERAGE LLC'),
    run(487, 758, 'LOAD NUMBER'),
    run(155, 746, 'PO BOX 100'),
    run(506, 745, loadNumber),
    run(155, 734, 'EXAMPLE, ND 58000'),
    run(155, 722, 'MC: 000000 P: 555-010-0199'),
    run(500, 722, date),
    run(233, 700, 'DISPATCH CONFIRMATION'),
    run(42, 680, 'Carrier:'),
    run(78, 680, 'SAMPLE CARRIER LLC'),
    run(299, 680, 'MCID:'),
    run(352, 680, '000000'),
    run(258, 650, 'Pay Code'),
    run(357, 650, 'Pay Type'),
    run(449, 650, 'Rate'),
    run(510, 650, 'Total'),
    run(258, 638, 'Load'),
    run(357, 638, 'Flat'),
    run(432, 638, '1,900.00'),
    run(495, 638, '1,900.00'),
    ...(
      [
        [45, 'Stop'], [98, 'From'], [126, 'To'], [156, 'Name'], [295, 'City'], [392, 'St'], [431, 'Ref'], [507, 'Appt'],
      ] as const
    ).map(([x, text]) => run(x, 610, text)),
    ...([[156, 'Address'], [295, 'Phone'], [392, 'Zip'], [431, 'Contact'], [507, 'Appt Ref']] as const).map(([x, text]) => run(x, 598, text)),
  ];
  let y = 580;
  for (const [i, s] of stops.entries()) {
    first.push(
      run(45, y, String(i + 1)),
      run(65, y, s.type),
      run(98, y, s.from),
      run(127, y, s.to),
      run(156, y, s.name),
      run(295, y, s.city),
      run(392, y, s.state),
      run(431, y, s.ref),
      run(508, y, s.appt),
      run(97, y - 12, s.fromTime),
      run(127, y - 12, s.toTime),
      run(156, y - 12, s.street),
      run(295, y - 12, s.phone),
      run(392, y - 12, s.zip),
      run(507, y - 12, s.apptRef),
    );
    if (s.notes) first.push(run(51, y - 28, 'Notes'), run(105, y - 28, s.notes));
    y -= s.notes ? 48 : 36;
  }
  first.push(
    run(45, y, 'Commodity'),
    run(138, y, 'Description'),
    run(377, y, 'Pieces'),
    run(432, y, 'Weight'),
    run(45, y - 20, 'GENERAL FREIGHT'),
    run(432, y - 20, '20,000'),
    run(42, y - 50, '$100 FEE FOR LATE PAPERWORK'),
  );
  const terms: TinyRun[] = [
    run(42, 770, 'DISPATCH CONFIRMATION'),
    run(525, 770, 'Page 2 of 2'),
    run(42, 758, `Load No ${later} - ${laterDate}`),
    run(60, 720, 'Example terms and conditions apply to this load.'),
  ];
  return [first, terms];
}

/** A pickup with a note, and a delivery whose phone is one token: the two-stop table. */
export const TABLE_STOPS: TableStop[] = [
  {
    type: 'PU',
    from: '10/12',
    to: '10/12',
    fromTime: '08:00',
    toTime: '16:00',
    name: 'PRAIRIE FOODS',
    city: 'BEMIDJI',
    state: 'MN',
    ref: 'R-1001',
    appt: 'No',
    street: '4001 MAIN ST',
    phone: '(555) 010-0100',
    zip: '56601',
    apptRef: 'A-1001',
    notes: 'CLEAN DRY TRAILER REQUIRED',
  },
  {
    type: 'Del',
    from: '10/13',
    to: '10/13',
    fromTime: '09:00',
    toTime: '10:30',
    name: 'LAKESIDE DC',
    city: 'DICKINSON',
    state: 'ND',
    ref: 'R-2002',
    appt: 'Yes',
    street: '1200 HARBOR RD',
    phone: '555-010-0101',
    zip: '58601',
    apptRef: 'A-2002',
  },
];

/** A middle stop for the three-stop table: one time, and the phone OCR runs together. */
export const TABLE_MIDDLE: TableStop = {
  type: 'Del',
  from: '10/12',
  to: '10/12',
  fromTime: '18:00',
  toTime: '18:00',
  name: 'NORTH YARD',
  city: 'WILLISTON',
  state: 'ND',
  ref: 'R-3003',
  appt: 'Yes',
  street: '77 DEPOT AVE',
  phone: '(555)010-0102',
  zip: '58801',
  apptRef: 'A-3003',
};

export interface DetailStop {
  type: 'PU' | 'SO';
  /** The "Name and Address" cell line by line, as printed, centred: the name, the street, "City, ST 12345". */
  cell: string[];
  /** Under "Scheduled Arrival", after the word "Arrival": "10/12/26", "14:30". */
  date: string;
  time: string;
  /** A window's end: the time is then printed "14:30 -", and this under it. */
  until?: string;
  /** Under "Scheduled Departure", line by line; "N/A" when not given. */
  departure?: string[];
}

/**
 * Phase 3ax. A stop detail table: a header on every page ("CARRIER RATE
 * CONFIRMATION PAGE n of 3", the date it was made, "Load Confirmation" and
 * the number under it, two barcodes' captions); page 1 the carrier, the pay
 * and the agreement; page 2 the order information, then "STOP DETAIL": a
 * three-line header, one row a stop with the name and address centred in its
 * column, then "NOTES"; page 3 terms. Only the printed headings are the
 * layout's: every value is made up. ASCII only.
 */
export function stopDetail(stops: DetailStop[], options: { loadNumber?: string; later?: string } = {}): TinyRun[][] {
  const { loadNumber = '7700451' } = options;
  const later = options.later ?? loadNumber;
  const header = (page: number, number: string): TinyRun[] => [
    run(387, 770, `CARRIER RATE CONFIRMATION PAGE ${page} of 3`),
    run(491, 758, 'CREATED 10/01/26 09:15'),
    run(262, 734, 'Load Confirmation'),
    run(288, 722, number),
    run(55, 708, `LZ${number}`),
    run(520, 708, 'AT1500.00'),
  ];
  /** Where a line of a centred cell starts. */
  const centred = (text: string) => Math.round(214 - text.length * 2.4);
  const first: TinyRun[] = [
    ...header(1, loadNumber),
    run(23, 680, 'CARRIER INFORMATION'),
    run(345, 680, 'CONTACT INFORMATION'),
    run(20, 668, 'Carrier'),
    run(148, 668, 'Contact'),
    run(342, 668, 'Example Broker Inc.'),
    run(20, 656, 'SAMPLE CARRIER LLC'),
    run(148, 656, 'DANA EXAMPLE'),
    run(342, 656, 'Casey Example'),
    run(20, 644, 'Minot, ND 58701'),
    run(23, 620, 'PAYMENT'),
    run(20, 608, 'Carrier Pay Breakdown'),
    run(386, 608, 'Bill To Address'),
    run(28, 596, 'LNH | Line Haul | Flat'),
    run(290, 596, '$1500.00'),
    run(386, 596, 'EXAMPLE BROKER'),
    run(386, 584, 'PO Box 100'),
    run(386, 572, 'Kearney, NE 68847'),
    run(20, 560, 'Total Carrier Pay'),
    run(296, 560, '$1500.00'),
    run(23, 530, 'AGREEMENT'),
    run(20, 518, 'Example terms and conditions apply to this load.'),
  ];
  const second: TinyRun[] = [
    ...header(2, later),
    run(23, 680, 'ORDER INFORMATION'),
    run(20, 668, 'Order #'),
    run(148, 668, 'Total Weight (lbs.)'),
    run(277, 668, 'Equipment'),
    run(407, 668, 'Temp'),
    run(498, 668, 'Reference #'),
    run(20, 656, loadNumber),
    run(148, 656, '20000.00'),
    run(277, 656, 'Van - 53 Feet'),
    run(407, 656, 'N/A - N/A'),
    run(500, 656, 'BM'),
    run(536, 656, 'EX-1001'),
    run(23, 630, 'STOP DETAIL'),
    run(60, 612, 'Scheduled'),
    run(110, 612, 'Scheduled'),
    run(418, 612, 'Weight (lbs)/Cases/'),
    run(25, 606, 'Type'),
    run(166, 606, 'Name and Address'),
    run(310, 606, 'Commodity'),
    run(548, 606, 'Reference #'),
    run(68, 600, 'Arrival'),
    run(112, 600, 'Departure'),
    run(451, 600, 'Dims'),
  ];
  let y = 580;
  for (const [i, s] of stops.entries()) {
    second.push(run(22, y, s.type), run(59, y, 'Arrival'), run(59, y - 10, s.date));
    if (s.until) second.push(run(59, y - 20, `${s.time} -`), run(59, y - 40, s.until));
    else second.push(run(59, y - 20, s.time));
    (s.departure ?? ['N/A']).forEach((text, k) => second.push(run(109, y - 10 * k, text)));
    s.cell.forEach((text, k) => second.push(run(centred(text), y - 15 * k, text)));
    second.push(
      run(270, y, 'GENERAL FREIGHT'),
      run(425, y, '20000'),
      run(459, y, '(1)'),
      run(414, y - 30, 'Dim: N/A x N/A x N/A'),
      run(522, y, 'SI'),
      run(549, y, `EX-${2001 + i}`),
    );
    y -= Math.max(s.cell.length, 4) * 15 + 30;
  }
  second.push(run(23, y, 'NOTES'), run(20, y - 12, 'Order Notes'), run(20, y - 24, 'Example: tracking is required for this load'));
  const terms: TinyRun[] = [
    ...header(3, later),
    run(20, 680, 'POD required : example terms apply'),
    run(20, 668, 'Pickup appointment required : example fine applies'),
  ];
  return [first, second, terms];
}

/** A pickup whose name wraps onto a second line, and a stop-off whose street wraps: the two-stop table. */
export const DETAIL_STOPS: DetailStop[] = [
  { type: 'PU', cell: ['Prairie Example Foods', 'Plant 2', '4001 Main St', 'Minot, ND 58701'], date: '10/12/26', time: '23:30' },
  { type: 'SO', cell: ['HARBOR COLD', '880 Harbor View', 'Pkwy Bldg 4', 'Mandan, ND 58554'], date: '10/14/26', time: '08:00' },
];

export interface DropStop {
  kind: 'Pickup' | 'Drop';
  name: string;
  /** The street row as printed: "4001 MAIN ST", or with ", c/o <name>" after it. */
  street: string;
  /** "Minot ND 58701": no comma. */
  cityLine: string;
  /** Beside the address: "10/12/2026 07:30". */
  earliest: string;
  latest: string;
}

/**
 * Phase 3ay. Pickup / Drop blocks: page 1 the title, the order number on its
 * own line, the rep and the trailer, an agreement paragraph and "Service for
 * Load # <n>" over the rate; page 2 more terms, then a block a stop: a
 * centred "Pickup" or "Drop" heading; the name, the street row, the city line
 * (no comma), a phone, boxes and the item on the left; the PKU# or DELV#
 * row, "Earliest:", "Latest:", weight and pallets on the right; a centred
 * "<kind> INSTRUCTIONS" row closing it; then the invoice requirements. Only
 * the printed headings are the layout's: every value is made up. ASCII only.
 */
export function pickupDropBlocks(stops: DropStop[], options: { order?: string; service?: string } = {}): TinyRun[][] {
  const { order = '51200433' } = options;
  const service = options.service ?? order;
  const first: TinyRun[] = [
    run(212, 760, 'LOAD CONFIRMATION'),
    run(171, 746, '24/7 DRIVER SUPPORT (555) 010-0150'),
    run(132, 720, `Call the Driver Support line and ask for Load Number ${order}`),
    run(239, 706, `ORDER ${order}`),
    run(23, 690, 'CARRIER'),
    run(104, 690, 'SAMPLE CARRIER LLC'),
    run(266, 690, '***ORDER NUMBER(S) MUST APPEAR ON ALL BILLING***'),
    run(23, 678, 'Example Rep'),
    run(104, 678, 'Dana Example'),
    run(266, 678, 'MODE: TL'),
    run(23, 666, 'Rep Phone'),
    run(104, 666, '(555) 010-0151'),
    run(266, 654, "TRAILER TYPE: Van 53'"),
    run(24, 620, `Pursuant to our agreement, load number ${order} will move at the following rate:`),
    run(23, 600, `Service for Load # ${service}`),
    run(173, 600, 'Amount'),
    run(241, 600, 'Rate'),
    run(309, 600, 'Extended'),
    run(23, 588, 'Line Haul'),
    run(181, 588, '1.00'),
    run(230, 588, '$1,500.00'),
    run(308, 588, '$1,500.00'),
    run(33, 560, '1.'),
    run(53, 560, 'Example terms and conditions apply to this load.'),
  ];
  const second: TinyRun[] = [run(33, 760, '2.'), run(53, 760, 'Example terms continue on this page.')];
  let y = 720;
  for (const s of stops) {
    second.push(run(s.kind === 'Pickup' ? 272 : 278, y, s.kind));
    const left = [s.name, s.street, s.cityLine, '5550100152', 'Boxes: 26', 'Item: General freight'];
    const right = [`${s.kind === 'Pickup' ? 'PKU#' : 'DELV#'} PO# 4100`, `Earliest: ${s.earliest}`, `Latest: ${s.latest}`, 'Weight: 40000', 'Pallets: 26'];
    left.forEach((text, k) => second.push(run(24, y - 14 * (k + 1), text)));
    right.forEach((text, k) => second.push(run(312, y - 14 * (k + 1), text)));
    second.push(run(s.kind === 'Pickup' ? 235 : 239, y - 14 * 7, `${s.kind} INSTRUCTIONS`));
    y -= 14 * 9;
  }
  second.push(run(23, y, 'INVOICE PAYMENT REQUIREMENTS:'), run(30, y - 12, 'SIGNED BOL / SIGNED RATE CONFIRMATION SHEET.'));
  return [first, second];
}

/** A pickup whose street row names its own facility after "c/o", and a drop: the two-stop document. */
export const DROP_STOPS: DropStop[] = [
  {
    kind: 'Pickup',
    name: 'Prairie Example Foods - Plant 2',
    street: '4001 Main St, c/o Prairie Example Foods - Plant 2',
    cityLine: 'MINOT ND 58701',
    earliest: '10/12/2026 07:30',
    latest: '10/12/2026 15:00',
  },
  {
    kind: 'Drop',
    name: 'HARBOR COLD',
    street: '880 HARBOR VIEW PKWY',
    cityLine: 'MANDAN ND 58554',
    earliest: '10/14/2026 08:00',
    latest: '10/14/2026 09:30',
  },
];
