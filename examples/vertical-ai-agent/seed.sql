CREATE TABLE departments (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    building TEXT NOT NULL
);

CREATE TABLE employees (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    department_id INT REFERENCES departments(id),
    title TEXT NOT NULL,
    salary NUMERIC(10, 2) NOT NULL,
    ssn TEXT NOT NULL,
    hired_at DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE projects (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    department_id INT REFERENCES departments(id),
    budget NUMERIC(12, 2) NOT NULL
);

INSERT INTO departments (name, building) VALUES
('Engineering', 'Building A'),
('Product', 'Building B'),
('Finance', 'Building C');

INSERT INTO employees (name, email, department_id, title, salary, ssn) VALUES
('Alice Chen', 'alice@example.com', 1, 'Senior Engineer', 165000.00, '000-11-2222'),
('Bob Smith', 'bob@example.com', 1, 'Staff Engineer', 185000.00, '000-22-3333'),
('Carol Danvers', 'carol@example.com', 2, 'Principal PM', 170000.00, '000-33-4444'),
('Dave Miller', 'dave@example.com', 3, 'Financial Analyst', 95000.00, '000-44-5555');

INSERT INTO projects (name, department_id, budget) VALUES
('Moat Platform', 1, 500000.00),
('Telemetry Aggregator', 1, 250000.00),
('Q3 Strategy', 2, 75000.00);
