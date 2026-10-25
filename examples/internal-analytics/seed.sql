CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    user_id INT NOT NULL,
    properties JSONB,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE daily_metrics (
    metric_date DATE PRIMARY KEY,
    active_users INT NOT NULL,
    total_events INT NOT NULL,
    revenue NUMERIC(14, 2) NOT NULL
);

INSERT INTO events (event_type, user_id, properties, occurred_at) VALUES
('sign_up', 101, '{"channel": "organic"}', NOW() - INTERVAL '3 days'),
('page_view', 101, '{"path": "/dashboard"}', NOW() - INTERVAL '3 days'),
('purchase', 101, '{"amount": 149.99, "currency": "USD"}', NOW() - INTERVAL '2 days'),
('sign_up', 102, '{"channel": "paid_ads"}', NOW() - INTERVAL '1 day'),
('purchase', 102, '{"amount": 49.00, "currency": "USD"}', NOW() - INTERVAL '1 day');

INSERT INTO daily_metrics (metric_date, active_users, total_events, revenue) VALUES
(CURRENT_DATE - 3, 450, 12400, 34200.50),
(CURRENT_DATE - 2, 480, 13150, 38900.00),
(CURRENT_DATE - 1, 510, 14200, 41250.75);

