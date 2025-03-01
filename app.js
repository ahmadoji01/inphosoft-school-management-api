// Dependencies
const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'teacher_student_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Helper functions
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const extractMentions = (text) => {
  const mentionRegex = /@([^\s@]+@[^\s@]+\.[^\s@]+)/g;
  const matches = text.match(mentionRegex) || [];
  return matches.map(match => match.substring(1)); // Remove the @ symbol
};

// Initialize database tables
async function initializeDatabase() {
  try {
    const connection = await pool.getConnection();
    
    // Create teachers table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS teachers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL
      )
    `);
    
    // Create students table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS students (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        suspended BOOLEAN DEFAULT FALSE
      )
    `);
    
    // Create registrations table for many-to-many relationship
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS registrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        teacher_id INT NOT NULL,
        student_id INT NOT NULL,
        FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
        UNIQUE KEY unique_registration (teacher_id, student_id)
      )
    `);
    
    connection.release();
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  }
}

app.post('/api/register', async (req, res) => {
  let connection;
  try {
    const { teacher, students } = req.body;

    // Validation
    if (!teacher || !students || !Array.isArray(students)) {
      return res.status(400).json({ message: 'Invalid request body format' });
    }

    if (!validateEmail(teacher)) {
      return res.status(400).json({ message: 'Invalid teacher email format' });
    }

    for (const student of students) {
      if (!validateEmail(student)) {
        return res.status(400).json({ message: `Invalid student email format: ${student}` });
      }
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Get or create teacher
    let [teacherRows] = await connection.execute('SELECT id FROM teachers WHERE email = ?', [teacher]);
    let teacherId;
    
    if (teacherRows.length === 0) {
      const [result] = await connection.execute('INSERT INTO teachers (email) VALUES (?)', [teacher]);
      teacherId = result.insertId;
    } else {
      teacherId = teacherRows[0].id;
    }

    // Process each student
    for (const studentEmail of students) {
      // Get or create student
      let [studentRows] = await connection.execute('SELECT id FROM students WHERE email = ?', [studentEmail]);
      let studentId;
      
      if (studentRows.length === 0) {
        const [result] = await connection.execute('INSERT INTO students (email) VALUES (?)', [studentEmail]);
        studentId = result.insertId;
      } else {
        studentId = studentRows[0].id;
      }

      // Register student with teacher (ignore if already registered)
      await connection.execute(
        'INSERT IGNORE INTO registrations (teacher_id, student_id) VALUES (?, ?)',
        [teacherId, studentId]
      );
    }

    await connection.commit();
    return res.status(204).send();
  } catch (error) {
    console.error('Error registering students:', error);
    if (connection) {
      await connection.rollback();
    }
    return res.status(500).json({ message: 'Internal server error' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

app.get('/api/commonstudents', async (req, res) => {
  let connection;
  try {
    const teachers = Array.isArray(req.query.teacher) ? req.query.teacher : [req.query.teacher];

    // Validation
    if (!teachers || teachers.length === 0) {
      return res.status(400).json({ message: 'At least one teacher must be specified' });
    }

    for (const teacher of teachers) {
      if (!validateEmail(teacher)) {
        return res.status(400).json({ message: `Invalid teacher email format: ${teacher}` });
      }
    }

    connection = await pool.getConnection();
    
    const placeholders = teachers.map(() => '?').join(','); // Create placeholders like "?, ?, ?"
    let query = `SELECT email FROM teachers WHERE email IN (${placeholders})`;
    const [teacherRows] = await connection.execute(query, teachers);
    
    if (teacherRows.length !== teachers.length) {
      return res.status(404).json({ message: 'One or more teachers not found' });
    }

    query = `
        SELECT s.email 
        FROM students s
        JOIN registrations r ON s.id = r.student_id
        JOIN teachers t ON t.id = r.teacher_id
        WHERE t.email IN (${placeholders})
        GROUP BY s.id
        HAVING COUNT(DISTINCT t.id) = ?
    `;
    const [studentRows] = await connection.execute(query, [...teachers, teachers.length]);

    const commonStudents = studentRows.map(row => row.email);
    
    return res.status(200).json({ students: commonStudents });
  } catch (error) {
    console.error('Error finding common students:', error);
    return res.status(500).json({ message: 'Internal server error' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// 3. Suspend a student
app.post('/api/suspend', async (req, res) => {
  let connection;
  try {
    const { student } = req.body;

    // Validation
    if (!student) {
      return res.status(400).json({ message: 'Student email is required' });
    }

    if (!validateEmail(student)) {
      return res.status(400).json({ message: 'Invalid student email format' });
    }

    connection = await pool.getConnection();
    
    // Check if student exists
    const [studentRows] = await connection.execute(
      'SELECT id FROM students WHERE email = ?',
      [student]
    );

    if (studentRows.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }

    // Suspend the student
    await connection.execute(
      'UPDATE students SET suspended = TRUE WHERE email = ?',
      [student]
    );

    return res.status(204).send();
  } catch (error) {
    console.error('Error suspending student:', error);
    return res.status(500).json({ message: 'Internal server error' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// 4. Retrieve students for notifications
app.post('/api/retrievefornotifications', async (req, res) => {
  let connection;
  try {
    const { teacher, notification } = req.body;

    // Validation
    if (!teacher || !notification) {
      return res.status(400).json({ message: 'Teacher and notification are required' });
    }

    if (!validateEmail(teacher)) {
      return res.status(400).json({ message: 'Invalid teacher email format' });
    }

    connection = await pool.getConnection();
    
    // Check if teacher exists
    const [teacherRows] = await connection.execute(
      'SELECT id FROM teachers WHERE email = ?',
      [teacher]
    );

    if (teacherRows.length === 0) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    const teacherId = teacherRows[0].id;
    
    // Get non-suspended students registered to teacher
    const [registeredStudents] = await connection.execute(`
      SELECT s.email 
      FROM students s
      JOIN registrations r ON s.id = r.student_id
      WHERE r.teacher_id = ? AND s.suspended = FALSE
    `, [teacherId]);

    // Get mentioned students
    const mentionedEmails = extractMentions(notification);
    
    // Get non-suspended mentioned students or create them if they don't exist
    const mentionedStudents = [];
    
    for (const email of mentionedEmails) {
      // Check if student exists
      let [studentRows] = await connection.execute(
        'SELECT id, suspended FROM students WHERE email = ?',
        [email]
      );
      
      if (studentRows.length === 0) {
        // Create new student
        await connection.execute('INSERT INTO students (email) VALUES (?)', [email]);
        mentionedStudents.push(email);
      } else if (!studentRows[0].suspended) {
        // Add existing non-suspended student
        mentionedStudents.push(email);
      }
    }

    // Combine both lists (removing duplicates)
    const registeredEmails = registeredStudents.map(row => row.email);
    const allRecipients = [...new Set([...registeredEmails, ...mentionedStudents])];

    return res.status(200).json({ recipients: allRecipients });
  } catch (error) {
    console.error('Error retrieving students for notification:', error);
    return res.status(500).json({ message: 'Internal server error' });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Initialize the database before starting the server
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});

module.exports = app; // Export for testing