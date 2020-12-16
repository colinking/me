import React from 'react'
import Link from 'next/link'
import Head from '../components/Head'
import { Video, Description, FooterLinks } from '../components/Home'

import { TEXT_COLOR, TEXT_SIZE } from '../components/lib/constants'

const Home = () => (
  <div>
    <Head title="Colin King" />

    <div id="content">
      <Video src="google-fast.mp4"/>
      <h1 id="name">Colin King</h1>
      <div id="description">
        <Description/>
      </div>
      <FooterLinks/>
    </div>

    <style jsx>{`
      :global(body) {
        border-top: 5px solid #65d091;
        margin: 0;
      }
      * {
        font-family: 'Inconsolata', sans-serif;
        color: ${TEXT_COLOR};
      }
      #content {
        max-width: 920px;
        margin: 100px auto;
        text-align: center;
        padding-left: 40px;
        padding-right: 40px;
      }
      #name {
        font-weight: 900;
        margin-top: 30px;
        font-size: ${TEXT_SIZE};
      }
      #description {
        margin-bottom: 50px;
      }
    `}</style>
  </div>
)

export default Home
