-- Reconcile legacy assignment verification timestamps with reservation state,
-- then derive delivered quantity from the saved reservation history.
UPDATE reservations r SET status='delivered',updated_at=NOW()
FROM reservation_assignments a
WHERE a.reservation_id=r.id AND a.delivery_verified_at IS NOT NULL AND r.status<>'delivered';

UPDATE donations d SET quantity_delivered=COALESCE((
  SELECT sum(r.quantity)::numeric(10,2) FROM reservations r WHERE r.donation_id=d.id AND r.status='delivered'
),0);
