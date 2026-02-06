"use client"

import { useSearchParams } from 'next/navigation'
import React, { useState, useEffect } from 'react'
import { ReactReader } from 'react-reader'
import EpubUploader from './upload'

export default function Home() {
  const searchParmas = useSearchParams()
  const bookUrl = searchParmas.get("bookUrl")
  const [location, setLocation] = useState<string | number>(0)
  const [bookData, setBookData] = useState<ArrayBuffer | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!bookUrl) {
      setLoading(false);
      return;
    }

    fetch(bookUrl)
      .then(res => res.arrayBuffer())
      .then(data => {
        setBookData(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [bookUrl]);

  if (loading) {
    return <div style={{ padding: '20px' }}>Loading book...</div>;
  }

  if (!bookData) {
    return <div style={{ padding: '20px' }}>Failed to load book</div>;
  }

  return (
    <>
        <EpubUploader />
        <div style={{ height: '100vh' }}>
        <ReactReader
            url={bookData as any}
            location={location}
            locationChanged={(epubcfi: string) => setLocation(epubcfi)}
        />
        </div>
    </>
  )
}