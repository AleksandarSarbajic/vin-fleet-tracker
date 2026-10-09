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
