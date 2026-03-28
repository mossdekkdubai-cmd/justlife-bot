import { test, expect } from '@playwright/test';

test('send unique Waiting Justlife bookings to ops webhook', async ({ page, request }) => {
  const JL_USER = 'ExclMDekkCW';
  const JL_PASS = '*MossD@CW#';

  const OPS_BASE = 'https://ops-command-center-mossdekkdubai.replit.app';
  const API_KEY =
    'mutto_81cef17c41e267aeed17ae644540363f713c68e54415dbf0';

  // ---- 1) Figure out today and fetch existing orders for today ----
  const today = new Date().toISOString().slice(0, 10); // "2026-03-28"

  const existingRes = await request.get(
    `${OPS_BASE}/api/webhooks/orders?date=${today}`,
    {
      headers: { 'X-Api-Key': API_KEY },
    }
  );
  expect(existingRes.ok()).toBeTruthy();

  const rawExisting = await existingRes.json();
  console.log('Raw existing response:', rawExisting);

  // Your API shape is: { orders: [...], count: 50 }
  const existingOrdersArray = Array.isArray(rawExisting)
    ? rawExisting
    : rawExisting.orders || [];

  const existingRefs = new Set(
    existingOrdersArray.map((o: { orderRef?: string }) => o.orderRef).filter(Boolean)
  );
  console.log('Existing orderRefs:', existingRefs);

  // ---- 2) Login to Justlife ----
  await page.goto('https://partner.justlife.com/login');
  await page.fill('input[placeholder="Username"]', JL_USER);
  await page.fill('input[placeholder="Password"]', JL_PASS);
  await page.click('button:has-text("Log in")');

  // ---- 3) Scrape Waiting bookings for today from Justlife ----
  await page.goto('https://partner.justlife.com/appointment/list');
  await page.waitForSelector('table tbody tr');

  const rows = page.locator('table tbody tr');
  const count = await rows.count();
  console.log('Row count =', count);

  type Booking = {
    customerName: string;
    orderReference: string;
    customerAddress: string;
    scheduledTime: string; // "2026-03-28 17:00"
    amountAed: string;     // "109 AED"
    payment: string;
    status: string;
  };

  const bookings: Booking[] = [];

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const cells = row.locator('td');
    const cellCount = await cells.count();
    if (cellCount < 11) continue;

    const reference = (await cells.nth(0).innerText()).trim();
    const clientName = (await cells.nth(3).innerText()).trim();
    const region = (await cells.nth(4).innerText()).trim();
    const startDateRaw = (await cells.nth(5).innerText()).trim();
    const bookingAmount = (await cells.nth(7).innerText()).trim();
    const paymentMethod = (await cells.nth(8).innerText()).trim();
    const status = (await cells.nth(10).innerText()).trim();

    const [datePart] = startDateRaw.split(' ');

    if (datePart !== today) continue;
    if (status.toLowerCase() !== 'waiting') continue;

    bookings.push({
      customerName: clientName,
      orderReference: reference,
      customerAddress: region,
      scheduledTime: startDateRaw,
      amountAed: bookingAmount,
      payment: paymentMethod,
      status,
    });
  }

  console.log('Waiting bookings from Justlife:', bookings);

  // ---- 4) Send only NEW bookings (orderRef not already in ops) ----
  for (const b of bookings) {
    if (existingRefs.has(b.orderReference)) {
      console.log('Skipping existing orderRef:', b.orderReference);
      continue;
    }

    const [d, t] = b.scheduledTime.split(' ');
    const scheduledIso = `${d}T${t}:00+04:00`;
    const amountNumber = Number(b.amountAed.replace(' AED', '').trim());

    const payload = {
      clientName: b.customerName,
      details: 'Justlife booking',
      scheduledTime: scheduledIso,
      customerNr: '',
      customerAddress: b.customerAddress,
      orderRef: b.orderReference,
      vehicleDetails: '',
      amountAed: amountNumber,
      payment: b.payment,
      zone: 0,
      jobTime: 60,
      platformUsed: 'Justlife',
    };

    console.log('Sending NEW payload:', payload);

    const res = await request.post(
      `${OPS_BASE}/api/webhooks/orders`,
      {
        headers: {
          'X-Api-Key': API_KEY,
          'Content-Type': 'application/json',
        },
        data: payload,
      }
    );

    expect(res.ok()).toBeTruthy();
    console.log('Webhook status', await res.status(), await res.text());
  }
});