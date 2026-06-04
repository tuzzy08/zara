const bookingSlots = ["10:30 AM", "11:00 AM", "12:30 AM"] as const;

export function MarketingGlassBookingCard() {
  return (
    <article className="glass-panel hero-glass-card hero-booking-card">
      <strong>Booking</strong>
      <div className="booking-date">May 27, 2026 <span>Tue</span></div>
      {bookingSlots.map((slot, index) => (
        <div className={index === 0 ? "booking-slot booking-slot-active" : "booking-slot"} key={slot}>
          {slot}
          {index === 0 ? <span>Booked</span> : null}
        </div>
      ))}
    </article>
  );
}
