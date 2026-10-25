-- User-supplied illustrative estimates; no jurisdiction or tax rate was supplied.
-- Rerunnable, including against the original model_name-based table.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('toyo-otd-estimates-v1', 0));
CREATE TABLE IF NOT EXISTS toyota_otd_estimates (
 id SERIAL PRIMARY KEY,
 model_name VARCHAR(100) NOT NULL,
 base_msrp NUMERIC(10,2) NOT NULL,
 taxes_and_fees NUMERIC(10,2) NOT NULL,
 estimated_otd_price NUMERIC(10,2) NOT NULL,
 calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TEMP TABLE toyo_otd_seed (model_name TEXT, base_msrp NUMERIC(10,2), taxes_and_fees NUMERIC(10,2), estimated_otd_price NUMERIC(10,2)) ON COMMIT DROP;
INSERT INTO toyo_otd_seed VALUES
('2026 Toyota Corolla Hybrid', 24975.00, 1863.94, 26838.94),
('2026 Toyota Corolla Cross', 25335.00, 1886.44, 27221.44),
('2026 Toyota Corolla Cross Hybrid', 29795.00, 2165.19, 31960.19),
('2026 Toyota Camry', 29600.00, 2153.00, 31753.00),
('2026 Toyota Prius', 28550.00, 2087.38, 30637.38),
('2026 Toyota RAV4', 31900.00, 2296.75, 34196.75),
('2026 Toyota Sienna', 41320.00, 2885.50, 44205.50),
('2026 Toyota Tacoma', 32545.00, 2337.06, 34882.06),
('2026 Toyota bZ', 34900.00, 2884.25, 37784.25);
UPDATE toyota_otd_estimates AS target SET
 base_msrp=seed.base_msrp, taxes_and_fees=seed.taxes_and_fees,
 estimated_otd_price=seed.estimated_otd_price,
 calculated_at=CASE WHEN (target.base_msrp,target.taxes_and_fees,target.estimated_otd_price) IS DISTINCT FROM (seed.base_msrp,seed.taxes_and_fees,seed.estimated_otd_price) THEN CURRENT_TIMESTAMP ELSE target.calculated_at END
FROM toyo_otd_seed AS seed WHERE target.model_name=seed.model_name;
INSERT INTO toyota_otd_estimates (model_name,base_msrp,taxes_and_fees,estimated_otd_price)
SELECT seed.* FROM toyo_otd_seed AS seed
WHERE NOT EXISTS (SELECT 1 FROM toyota_otd_estimates AS target WHERE target.model_name=seed.model_name);
COMMIT;
