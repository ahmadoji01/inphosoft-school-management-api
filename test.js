/**
 * Test file for Teacher-Student API with MySQL
 * 
 * To run these tests, you'll need to set up the database first and ensure
 * the connection details are correct
 */

const request = require('supertest');
const mysql = require('mysql2/promise');
const app = require('./app'); // Import your Express app

// Database configuration (should match app config)
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

// Setup function to reset the database before tests
async function resetDatabase() {
  const connection = await pool.getConnection();
  try {
    // Drop and recreate tables
    await connection.execute('SET FOREIGN_KEY_CHECKS = 0');
    await connection.execute('TRUNCATE TABLE registrations');
    await connection.execute('TRUNCATE TABLE students');
    await connection.execute('TRUNCATE TABLE teachers');
    await connection.execute('SET FOREIGN_KEY_CHECKS = 1');
    
    console.log('Database reset complete');
  } catch (error) {
    console.error('Error resetting database:', error);
  } finally {
    connection.release();
  }
}

// Test for registering students
async function testRegisterStudents() {
  const response = await request(app)
    .post('/api/register')
    .send({
      teacher: "teacherken@gmail.com",
      students: [
        "studentjon@gmail.com",
        "studenthon@gmail.com"
      ]
    });
  
  console.assert(response.status === 204, 'Register students should return 204');
  
  // Verify data in database
  const connection = await pool.getConnection();
  try {
    // Check teacher exists
    const [teacherRows] = await connection.execute(
      'SELECT id FROM teachers WHERE email = ?',
      ['teacherken@gmail.com']
    );
    console.assert(teacherRows.length === 1, 'Teacher should exist in database');
    
    // Check students exist
    const [studentRows] = await connection.execute(
      'SELECT email FROM students WHERE email IN (?, ?)',
      ['studentjon@gmail.com', 'studenthon@gmail.com']
    );
    console.assert(studentRows.length === 2, 'Both students should exist in database');
    
    // Check registrations
    const [registrationRows] = await connection.execute(`
      SELECT COUNT(*) as count
      FROM registrations r
      JOIN teachers t ON t.id = r.teacher_id
      JOIN students s ON s.id = r.student_id
      WHERE t.email = ? AND s.email IN (?, ?)
    `, ['teacherken@gmail.com', 'studentjon@gmail.com', 'studenthon@gmail.com']);
    
    console.assert(registrationRows[0].count === 2, 'Both students should be registered to teacher');
  } finally {
    connection.release();
  }
}

// Test for common students with one teacher
async function testCommonStudentsOneTeacher() {
  // First register some students
  await request(app)
    .post('/api/register')
    .send({
      teacher: "teacherken@gmail.com",
      students: [
        "commonstudent1@gmail.com",
        "commonstudent2@gmail.com",
        "student_only_under_teacher_ken@gmail.com"
      ]
    });
  
  const response = await request(app)
    .get('/api/commonstudents?teacher=teacherken@gmail.com');
  
  console.assert(response.status === 200, 'Common students should return 200');
  console.assert(response.body.students.includes('commonstudent1@gmail.com'), 'Response should include commonstudent1');
  console.assert(response.body.students.includes('commonstudent2@gmail.com'), 'Response should include commonstudent2');
  console.assert(response.body.students.includes('student_only_under_teacher_ken@gmail.com'), 'Response should include student_only_under_teacher_ken');
}

// Test for common students with multiple teachers
async function testCommonStudentsMultipleTeachers() {
  // Register students to teacherken
  await request(app)
    .post('/api/register')
    .send({
      teacher: "teacherken@gmail.com",
      students: [
        "commonstudent1@gmail.com",
        "commonstudent2@gmail.com",
        "student_only_under_teacher_ken@gmail.com"
      ]
    });
  
  // Register students to teacherjoe
  await request(app)
    .post('/api/register')
    .send({
      teacher: "teacherjoe@gmail.com",
      students: [
        "commonstudent1@gmail.com",
        "commonstudent2@gmail.com",
        "student_only_under_teacher_joe@gmail.com"
      ]
    });
  
  const response = await request(app)
    .get('/api/commonstudents?teacher=teacherken@gmail.com&teacher=teacherjoe@gmail.com');
  
  console.assert(response.status === 200, 'Common students should return 200');
  console.assert(response.body.students.includes('commonstudent1@gmail.com'), 'Response should include commonstudent1');
  console.assert(response.body.students.includes('commonstudent2@gmail.com'), 'Response should include commonstudent2');
  console.assert(!response.body.students.includes('student_only_under_teacher_ken@gmail.com'), 'Response should not include student_only_under_teacher_ken');
  console.assert(!response.body.students.includes('student_only_under_teacher_joe@gmail.com'), 'Response should not include student_only_under_teacher_joe');
}

// Test for suspending a student
async function testSuspendStudent() {
  // First register a student
  await request(app)
    .post('/api/register')
    .send({
      teacher: "teacherken@gmail.com",
      students: ["studentmary@gmail.com"]
    });
  
  const response = await request(app)
    .post('/api/suspend')
    .send({
      student: "studentmary@gmail.com"
    });
  
  console.assert(response.status === 204, 'Suspend student should return 204');
  
  // Verify student is suspended in database
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.execute(
      'SELECT suspended FROM students WHERE email = ?',
      ['studentmary@gmail.com']
    );
    console.assert(rows.length === 1, 'Student should exist');
    console.assert(rows[0].suspended === 1, 'Student should be suspended');
  } finally {
    connection.release();
  }
}

// Test for retrieving students for notifications with mentions
async function testRetrieveForNotificationsWithMentions() {
  // Register students
  await request(app)
    .post('/api/register')
    .send({
      teacher: "teacherken@gmail.com",
      students: ["studentbob@gmail.com"]
    });
  
  const response = await request(app)
    .post('/api/retrievefornotifications')
    .send({
      teacher: "teacherken@gmail.com",
      notification: "Hello students! @studentagnes@gmail.com @studentmiche@gmail.com"
    });
  
  console.assert(response.status === 200, 'Retrieve for notifications should return 200');
  console.assert(response.body.recipients.includes('studentbob@gmail.com'), 'Response should include studentbob');
  console.assert(response.body.recipients.includes('studentagnes@gmail.com'), 'Response should include studentagnes');
  console.assert(response.body.recipients.includes('studentmiche@gmail.com'), 'Response should include studentmiche');
  
  // Verify mentioned students were created in database
  const connection = await pool.getConnection();
  try {
    const [rows] = await connection.execute(
      'SELECT COUNT(*) as count FROM students WHERE email IN (?, ?)',
      ['studentagnes@gmail.com', 'studentmiche@gmail.com']
    );
    console.assert(rows[0].count === 2, 'Mentioned students should be created in database');
  } finally {
    connection.release();
  }
}

// Test for retrieving students for notifications without mentions
async function testRetrieveForNotificationsWithoutMentions() {
  // Register students
  await request(app)
    .post('/api/register')
    .send({
      teacher: "teacherken@gmail.com",
      students: ["studentbob@gmail.com"]
    });
  
  // Suspend a different student
  await request(app)
    .post('/api/suspend')
    .send({
      student: "studentmary@gmail.com"
    });
  
  const response = await request(app)
    .post('/api/retrievefornotifications')
    .send({
      teacher: "teacherken@gmail.com",
      notification: "Hey everybody"
    });
  
  console.assert(response.status === 200, 'Retrieve for notifications should return 200');
  console.assert(response.body.recipients.includes('studentbob@gmail.com'), 'Response should include studentbob');
  console.assert(response.body.recipients.length === 1, 'Response should only include registered, non-suspended students');
}

// Run all tests
async function runTests() {
  try {
    // Reset database before tests
    await resetDatabase();
    
    await testRegisterStudents();
    await resetDatabase();
    
    await testCommonStudentsOneTeacher();
    await resetDatabase();
    
    await testCommonStudentsMultipleTeachers();
    await resetDatabase();
    
    await testSuspendStudent();
    await resetDatabase();
    
    await testRetrieveForNotificationsWithMentions();
    await resetDatabase();
    
    await testRetrieveForNotificationsWithoutMentions();
    
    console.log('All tests passed!');
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    // Close the connection pool
    await pool.end();
  }
}

runTests(); // Uncomment to run tests