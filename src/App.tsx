import { useState } from 'react'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
    <h1>Hello World</h1>
    <div className='counter' onClick={() => setCount(count + 1)}>{count}</div>
    </>
  )
}

export default App
