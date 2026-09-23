## **Problem Statement**  
You are tasked with building a **distributed pendulum simulation** in Node.js, which can be visualized and controlled through a React UI. 
The goal of this exercise is to evaluate your skills in server-side programming, API design, frontend development, and distributed systems coordination. 
The assignment involves both server and client-side components that need to interact seamlessly.

![image](https://github.com/user-attachments/assets/90c4e53d-466e-4bb6-b177-b211cd87e6dd)

## **Evaluation Criteria**  
We are evaluating both the final result and the engineering decisions behind it.

#### Simplicity
The solution should be easy to understand, run, and maintain. Avoid unnecessary complexity and abstractions.

#### Scalability and Extensibility
Although the assignment requires five servers, the design should not depend heavily on that exact number. Adding new instances, changing the system configuration, or introducing new features should require minimal changes.

#### Engineering Intent
Your code, structure, and README should clearly communicate your decisions, assumptions, trade-offs, and known limitations.

#### Testing
Include meaningful tests that demonstrate how you validate the reliability of your solution. We are interested in the quality, relevance, and clarity of the tests rather than a specific amount of coverage.

#### Overall Quality
We will also consider code readability, separation of concerns, API design, error handling, documentation, setup simplicity, and UI usability.

## **Checklist of Requirements and Bonus Points**  

### **Mandatory Requirements**  
- **Server-side pendulum simulation using Node.js** 
  - [ ] Implement a Node.js server which runs a single pendulum simulation with configurable parameters for: initial angle, mass, and string length
  - [ ] Run **five separate instances of this server**, so the full system is **composed of multiple servers**, each responsible for its own pendulum

- **Neighbor Communication**  
  - [ ] Make each pendulum aware of its neighbors and monitor their positions
  - [ ] Define a threshold for collisions
  - [ ] When a collision is detected, send a **STOP message** to all instances 
  - [ ] After a STOP, the simulation should halt. The pendulum sends a **RESTART message** and waits until all instances receive **RESTART messages** from all other instances, at which point each pendulum waits 5 seconds and **restarts**  

- **Web-Based UI**  
  - [ ] Build a React UI to render the pendulums
  - [ ] Allow users to configure the pendulums
  - [ ] Add basic simulation controls: start, pause, and stop
  - [ ] Ensure the UI periodically updates pendulum positions (e.g., every few frames)

## **Bonus Points**  
- [ ] Provide an **intuitive user experience** for configuring pendulums (starting angle, mass, string length, string anchor)
- [ ] Use TypeScript for both the frontend and the backend
- [ ] Add wind to the simulation
- [ ] Allow the entire stack to run with a single command
- [ ] Write unit tests for the REST API and important Node.js logic
- [ ] Add anything else that demonstrates your skills and engineering judgment

## **Submission**  
- [ ] Share your solution through a GitHub repository
- [ ] Include a README explaining:
  - How to install and run the project
  - The architecture of the solution
  - Important technical decisions and trade-offs
  - Known limitations
  - How to run the tests

Have fun!

