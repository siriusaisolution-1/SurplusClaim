import { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader('Content-Type', 'application/json');
  res.write(JSON.stringify({ status: 'ok' }));
  res.end();

  return {
    props: {}
  };
};

export default function Health() {
  return null;
}
