DROP INDEX IF EXISTS contacts_sales_ai_contact_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_sales_ai_contact_id_unique ON contacts(sales_ai_contact_id);
